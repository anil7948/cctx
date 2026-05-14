import { writeFileSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, normalize, isAbsolute } from "node:path";
import { listSessions, getSession, getOrCreateActiveSession } from "../store/sessions.js";
import { listTurns, recordTurn } from "../store/turns.js";
import { listSummaries } from "../store/summaries.js";
import { compressionStatsForSession } from "../store/tool-compressions.js";
import { flushSession as flushQueue, queueSummarization } from "../summarizer/queue.js";
import { fmt, formatTokens, formatPercent } from "./format.js";
import { buildProjectMap } from "../indexer/map-builder.js";
import { estimateTokens } from "../utils/tokenizer.js";
import { loadConfig } from "../utils/config.js";
import { log } from "../utils/logger.js";

function formatAge(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function sessionList(): void {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log(fmt.warn("No sessions for this project yet."));
    return;
  }
  console.log(fmt.bold("Sessions:"));
  for (const s of sessions) {
    const turns = listTurns(s.id).length;
    const summaries = listSummaries(s.id).length;
    console.log(
      `  ${s.id.slice(0, 8)}  ${formatAge(s.last_active)} ago  ${turns} turns  ${summaries} summarized  model=${s.model_used ?? "—"}`,
    );
  }
}

function printSessionStats(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) {
    console.log(fmt.err(`No session ${sessionId}`));
    process.exitCode = 1;
    return;
  }

  const turns = listTurns(sessionId);
  const summaries = listSummaries(sessionId);
  const toolStats = compressionStatsForSession(sessionId);

  const rawTurns = turns.reduce((a, t) => a + t.raw_tokens_est, 0);
  const compressedTurns = summaries.reduce((a, s) => a + s.compressed_tokens_est, 0);
  const layer3Saved = Math.max(0, rawTurns - compressedTurns);

  const grandRaw = rawTurns + toolStats.total.raw;
  const grandCompressed = compressedTurns + toolStats.total.compressed;
  const grandSaved = Math.max(0, grandRaw - grandCompressed);

  console.log(fmt.bold(`Session ${sessionId.slice(0, 8)} (${formatAge(session.last_active)} ago)`));
  console.log("");
  console.log(fmt.bold("Layer 2 — tool result compression"));
  if (toolStats.byTool.length === 0) {
    console.log("  (no tool calls recorded)");
  } else {
    for (const t of toolStats.byTool) {
      console.log(
        `  ${t.tool_type.padEnd(14)} ${String(t.calls).padStart(4)} calls   ` +
          `${formatTokens(t.raw).padStart(8)} → ${formatTokens(t.compressed).padStart(8)}   ` +
          `saved ${formatTokens(t.saved)} (${formatPercent(t.saved, t.raw)})`,
      );
    }
    console.log(
      `  ${"TOTAL".padEnd(14)} ${String(toolStats.total.calls).padStart(4)} calls   ` +
        `${formatTokens(toolStats.total.raw).padStart(8)} → ${formatTokens(toolStats.total.compressed).padStart(8)}   ` +
        `saved ${formatTokens(toolStats.total.saved)} (${formatPercent(toolStats.total.saved, toolStats.total.raw)})`,
    );
  }
  console.log("");
  console.log(fmt.bold("Layer 3 — turn summarization"));
  console.log(`  Turns:           ${turns.length} (${summaries.length} summarized, ${turns.length - summaries.length} pending)`);
  console.log(`  Raw tokens:      ${formatTokens(rawTurns)}`);
  console.log(`  After summary:   ${formatTokens(compressedTurns)}`);
  console.log(`  Saved:           ${formatTokens(layer3Saved)} (${formatPercent(layer3Saved, rawTurns)})`);
  console.log("");
  console.log(fmt.bold("Grand total"));
  console.log(`  Saved:           ${formatTokens(grandSaved)} of ${formatTokens(grandRaw)} (${formatPercent(grandSaved, grandRaw)})`);
}

export function sessionStats(sessionId?: string, opts: { watch?: boolean } = {}): void {
  let target = sessionId;
  if (!target) {
    const list = listSessions();
    if (list.length === 0) {
      console.log(fmt.warn("No sessions found."));
      return;
    }
    target = list[0]!.id;
  }

  if (opts.watch) {
    const run = () => {
      console.clear();
      const ts = new Date().toLocaleTimeString();
      console.log(
        fmt.bold("cctx session stats") +
          "  ·  " +
          fmt.dim(`session ${target!.slice(0, 8)}`) +
          "  ·  " +
          fmt.dim(`updated ${ts}`) +
          fmt.dim("  (Ctrl+C to exit)"),
      );
      console.log("");
      printSessionStats(target!);
    };
    run();
    const interval = setInterval(run, 3000);
    process.on("SIGINT", () => {
      clearInterval(interval);
      process.exit(0);
    });
  } else {
    printSessionStats(target);
  }
}

export async function sessionFlush(sessionId?: string): Promise<void> {
  const target = sessionId ?? listSessions()[0]?.id;
  if (!target) {
    console.log(fmt.warn("No sessions found."));
    return;
  }
  await flushQueue(target);
  console.log(fmt.ok(`Flushed session ${target.slice(0, 8)}`));
}

// --- Stop hook integration ---

interface TranscriptEntry {
  type: string;
  message?: {
    role: "user" | "assistant" | "system";
    content: string | Array<{ type: string; text?: string }>;
  };
  cwd?: string;
}

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

function validateTranscriptPath(rawPath: unknown): string | null {
  if (typeof rawPath !== "string" || !rawPath) return null;
  // Reject obviously malicious inputs before any filesystem call.
  const normalized = normalize(rawPath);
  if (!isAbsolute(normalized)) return null;
  if (normalized.includes("..")) return null;

  // Resolve symlinks on both sides so /tmp (macOS) == /private/tmp comparisons work.
  let resolved: string;
  try {
    resolved = realpathSync(normalized);
  } catch {
    // File doesn't exist or permission denied — silently skip.
    return null;
  }

  const allowedBases = [
    join(homedir(), ".claude"),
    (() => { try { return realpathSync(tmpdir()); } catch { return tmpdir(); } })(),
  ];

  for (const base of allowedBases) {
    if (resolved.startsWith(base + "/") || resolved === base) return resolved;
  }

  log.warn(`hookStop: transcript path outside allowed dirs: ${resolved}`);
  return null;
}

export async function hookStop(): Promise<void> {
  // Read the Stop hook JSON payload from stdin
  const raw = await new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => resolve(buf));
  });

  let payload: { transcript_path?: string; session_id?: string };
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.exit(0);
  }

  const transcriptPath = validateTranscriptPath(payload.transcript_path);
  if (!transcriptPath) process.exit(0);

  if (!existsSync(transcriptPath)) process.exit(0);

  let lines: TranscriptEntry[];
  try {
    lines = readFileSync(transcriptPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TranscriptEntry);
  } catch {
    process.exit(0);
  }

  // Find the last assistant entry and the user entry immediately before it
  const messages = lines.filter((e) => e.type === "user" || e.type === "assistant");
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.type === "assistant" && messages[i]!.message?.content) {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) process.exit(0);

  let lastUserIdx = -1;
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    if (messages[i]!.type === "user" && messages[i]!.message?.content) {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) process.exit(0);

  const userEntry = messages[lastUserIdx]!;
  const assistantEntry = messages[lastAssistantIdx]!;

  const prompt = extractText(userEntry.message!.content);
  const response = extractText(assistantEntry.message!.content);
  if (!prompt.trim() || !response.trim()) process.exit(0);

  // Use the cwd from the transcript entry so the right project DB is used
  const cwd = userEntry.cwd ?? assistantEntry.cwd ?? process.cwd();

  const cfg = loadConfig(cwd);
  const session = getOrCreateActiveSession(cfg.model.active, cwd);
  const tokens = estimateTokens(prompt) + estimateTokens(response);
  recordTurn({ sessionId: session.id, prompt, response, rawTokensEst: tokens }, cwd);
  queueSummarization(session.id, cwd).catch(() => undefined);
}

export function sessionExport(args: { sessionId?: string; format: "json" | "md"; out?: string }): void {
  const target = args.sessionId ?? listSessions()[0]?.id;
  if (!target) {
    console.log(fmt.warn("No sessions found."));
    return;
  }
  const session = getSession(target);
  const summaries = listSummaries(target);
  const codebase = buildProjectMap();

  let content: string;
  if (args.format === "json") {
    content = JSON.stringify(
      {
        session,
        summaries: summaries.map((s) => ({ turn_id: s.turn_id, ...s.parsed })),
        codebase_map: codebase,
      },
      null,
      2,
    );
  } else {
    const lines: string[] = [
      `# Session ${target}`,
      "",
      "## Codebase map",
      "",
      "```",
      codebase,
      "```",
      "",
      "## Summarized turns",
      "",
    ];
    for (const s of summaries) {
      const j = s.parsed;
      lines.push(`### ${j.topic}`);
      if (j.decisions.length) lines.push(`- Decisions: ${j.decisions.join("; ")}`);
      if (j.code_changes.length) {
        lines.push(`- Code: ${j.code_changes.map((c) => `${c.file} — ${c.change}`).join("; ")}`);
      }
      if (j.symbols.length) lines.push(`- Symbols: ${j.symbols.join(", ")}`);
      if (j.errors_resolved.length) lines.push(`- Resolved: ${j.errors_resolved.join("; ")}`);
      if (j.open_questions.length) lines.push(`- Open: ${j.open_questions.join("; ")}`);
      if (j.context_for_next) lines.push(`- Carry forward: ${j.context_for_next}`);
      lines.push("");
    }
    content = lines.join("\n");
  }

  if (args.out) {
    writeFileSync(args.out, content, "utf8");
    console.log(fmt.ok(`Wrote ${args.out}`));
  } else {
    process.stdout.write(content + "\n");
  }
}
