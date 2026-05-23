import { compress } from "../compressor/dispatcher.js";
import { recordCompression } from "../store/tool-compressions.js";
import { getOrCreateActiveSession } from "../store/sessions.js";
import { loadConfig } from "../utils/config.js";
import { estimateTokens } from "../utils/tokenizer.js";
import type { ToolType } from "../compressor/types.js";

// Empirically verified tool_response shapes (v2.1.144, PostToolUse hook capture):
//
//   Bash:  { stdout: string, stderr: string, interrupted: bool, isImage: bool, noOutputExpected: bool }
//   Read:  { type: "text", file: { filePath: string, content: string, numLines: N, startLine: N, totalLines: N } }
//   Grep:  Not captured — Claude Code rarely fires the Grep tool (uses Bash grep instead).
//          Handled defensively: try string → stdout → content field order.

const TOOL_TYPE_MAP: Record<string, ToolType> = {
  Bash: "bash",
  Read: "read_file",
  Grep: "grep",
  Glob: "list_dir",
};

const MIN_LINES = 30;

/**
 * PostToolUse hook handler — `cctx session compress-hook`
 *
 * Claude Code pipes the PostToolUse JSON payload to stdin. This handler:
 *   1. Extracts the tool output text from tool_response
 *   2. Skips if output is ≤ MIN_LINES
 *   3. Compresses with the existing compressor pipeline
 *   4. Writes hookSpecificOutput.updatedToolOutput JSON to stdout
 *
 * Claude Code substitutes the compressed text for the raw tool output
 * BEFORE it enters the model's context window — genuine context token reduction.
 *
 * Exits silently (no stdout) on any error or when no tokens are saved, so
 * Claude Code always falls back to using the original output.
 */
export async function compressHook(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw.trim()) as Record<string, unknown>;
  } catch {
    process.exit(0);
  }

  const toolName = String(payload.tool_name ?? "");
  const toolType: ToolType = TOOL_TYPE_MAP[toolName] ?? "unknown";
  if (toolType === "unknown") process.exit(0);

  const toolContent = extractText(toolName, payload.tool_response);
  if (!toolContent || toolContent.split("\n").length <= MIN_LINES) process.exit(0);

  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
  const command = typeof toolInput.command === "string" ? toolInput.command : undefined;
  const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : undefined;

  let result: Awaited<ReturnType<typeof compress>>;
  try {
    result = await compress({ toolType, rawOutput: toolContent, command, filePath });
  } catch {
    process.exit(0);
  }

  const rawTokens = estimateTokens(toolContent);
  const savedTokens = rawTokens - result.compressedTokens;
  if (savedTokens <= 0) process.exit(0);

  // Record compression stats in session DB (non-fatal if DB is unavailable)
  try {
    const cfg = loadConfig();
    const session = getOrCreateActiveSession(cfg.model.active);
    recordCompression({
      sessionId: session.id,
      toolType,
      rawTokensEst: rawTokens,
      compressedTokensEst: result.compressedTokens,
      strategy: result.strategy,
    });
  } catch {
    // ignore
  }

  // updatedToolOutput must mirror the tool's exact output schema — Claude Code
  // validates it with H.outputSchema.safeParse() and falls back to original if
  // it doesn't match. So we rebuild the same shape with compressed content inside.
  const header = `[cctx: ${result.strategy} · saved ${savedTokens} tokens (${rawTokens}→${result.compressedTokens})]\n`;
  const compressedText = header + result.compressed;
  const updatedToolOutput = buildUpdatedOutput(toolName, payload.tool_response, compressedText);
  if (!updatedToolOutput) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput,
      },
    }),
  );
  process.exit(0);
}

/**
 * Build updatedToolOutput that matches the tool's own output schema.
 * Claude Code validates the value with H.outputSchema.safeParse() and uses
 * the original if it doesn't match — so we must mirror the exact shape.
 *
 * Verified shapes (v2.1.144 live capture):
 *   Bash:  { stdout, stderr, interrupted, isImage, noOutputExpected }
 *   Read:  { type: "text", file: { filePath, content, numLines, startLine, totalLines } }
 */
function buildUpdatedOutput(toolName: string, originalResponse: unknown, compressedText: string): unknown | null {
  if (toolName === "Bash") {
    const r = originalResponse as Record<string, unknown>;
    return {
      stdout: compressedText,
      stderr: r.stderr ?? "",
      interrupted: r.interrupted ?? false,
      isImage: r.isImage ?? false,
      noOutputExpected: r.noOutputExpected ?? false,
    };
  }
  if (toolName === "Read") {
    const r = originalResponse as Record<string, unknown>;
    const origFile = (r.file ?? {}) as Record<string, unknown>;
    const compressedLines = compressedText.split("\n").length;
    return {
      type: r.type ?? "text",
      file: {
        filePath: origFile.filePath ?? "",
        content: compressedText,
        numLines: compressedLines,
        startLine: origFile.startLine ?? 1,
        totalLines: origFile.totalLines ?? compressedLines,
      },
    };
  }
  if (toolName === "Grep" || toolName === "Glob") {
    // For Grep/Glob: if original was a string, return string; otherwise pass through
    if (typeof originalResponse === "string") return compressedText;
    // Otherwise we don't know the schema — don't risk a mismatch
    return null;
  }
  return null;
}

function extractText(toolName: string, response: unknown): string | null {
  if (response == null) return null;

  // Bash: { stdout, stderr, interrupted, isImage, noOutputExpected }
  if (toolName === "Bash") {
    const r = response as Record<string, unknown>;
    const stdout = typeof r.stdout === "string" ? r.stdout : "";
    const stderr = typeof r.stderr === "string" ? r.stderr : "";
    if (!stdout && !stderr) return null;
    return stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
  }

  // Read: { type: "text", file: { filePath, content, numLines, startLine, totalLines } }
  if (toolName === "Read") {
    const r = response as Record<string, unknown>;
    const file = r.file as Record<string, unknown> | undefined;
    if (file && typeof file.content === "string") return file.content || null;
    if (typeof response === "string") return response || null;
    return null;
  }

  // Glob/LS: typically a list of filenames as a string
  if (toolName === "Glob" || toolName === "LS") {
    if (typeof response === "string") return response || null;
    const r = response as Record<string, unknown>;
    if (typeof r.output === "string") return r.output || null;
    return null;
  }

  // Grep: shape not empirically confirmed — try common patterns defensively
  if (typeof response === "string") return response || null;
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>;
    for (const key of ["stdout", "output", "content", "text", "results"]) {
      if (typeof r[key] === "string" && r[key]) return r[key] as string;
    }
  }
  return null;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => resolve(buf));
  });
}
