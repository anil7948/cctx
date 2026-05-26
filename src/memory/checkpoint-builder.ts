/**
 * Session checkpoint builder.
 *
 * When flush_session is called, this module synthesizes session_knowledge +
 * the last few turn summaries into a structured markdown checkpoint note.
 * The checkpoint is stored in session_checkpoints and injected at the start
 * of the next session's get_optimized_context response (turns 0-2).
 *
 * Design: best-effort — if Ollama is down or returns bad JSON, we fall back to
 * a deterministic template built from session_knowledge rows. Never throws.
 */

import { clientFromConfig } from "../ollama/client.js";
import { loadConfig } from "../utils/config.js";
import { listSessionKnowledge } from "../store/session-knowledge.js";
import { listSummaries } from "../store/summaries.js";
import { saveCheckpoint } from "../store/session-checkpoints.js";
import { projectRoot } from "../utils/paths.js";
import { log } from "../utils/logger.js";

const CHECKPOINT_SYSTEM =
  `You are a session handoff assistant. Your job is to write a concise markdown checkpoint ` +
  `summarizing what was accomplished in a coding session so the next session can pick up immediately. ` +
  `Output ONLY the markdown — no JSON, no extra commentary.`;

function buildCheckpointPrompt(
  topic: string,
  decisions: string[],
  openQuestions: string[],
  nextSteps: string,
  codeChanges: string[],
): string {
  const parts: string[] = [
    `Create a brief session checkpoint in this exact format:`,
    ``,
    `**Last working on**: [one sentence describing what was being built/fixed]`,
    `**Key decisions**: [bullet list of the most important architectural or approach decisions, max 4]`,
    `**Open questions**: [bullet list of unresolved questions, max 3. Omit section if none]`,
    `**Next steps**: [what to do at the start of next session, 1-2 sentences]`,
    ``,
    `Data to use:`,
    `Topic: ${topic}`,
  ];
  if (decisions.length) parts.push(`Decisions:\n${decisions.slice(0, 6).map((d) => `- ${d}`).join("\n")}`);
  if (codeChanges.length) parts.push(`Recent code changes:\n${codeChanges.slice(0, 4).map((c) => `- ${c}`).join("\n")}`);
  if (openQuestions.length) parts.push(`Open questions:\n${openQuestions.slice(0, 4).map((q) => `- ${q}`).join("\n")}`);
  if (nextSteps) parts.push(`Next steps hint: ${nextSteps}`);
  return parts.join("\n");
}

/** Build a deterministic fallback checkpoint from session_knowledge rows (no Ollama). */
function buildFallbackCheckpoint(
  topic: string,
  decisions: string[],
  openQuestions: string[],
  nextSteps: string,
): string {
  const lines: string[] = [`**Last working on**: ${topic || "see session history"}`];
  if (decisions.length) {
    lines.push(`**Key decisions**:`);
    for (const d of decisions.slice(0, 4)) lines.push(`- ${d}`);
  }
  if (openQuestions.length) {
    lines.push(`**Open questions**:`);
    for (const q of openQuestions.slice(0, 3)) lines.push(`- ${q}`);
  }
  if (nextSteps) lines.push(`**Next steps**: ${nextSteps}`);
  return lines.join("\n");
}

export async function buildCheckpoint(
  sessionId: string,
  cwd: string = process.cwd(),
): Promise<void> {
  try {
    const cfg = loadConfig(cwd);
    if (!cfg.memory.enabled) return;

    const knowledge = listSessionKnowledge(sessionId, cwd);
    const summaries = listSummaries(sessionId, cwd);
    if (knowledge.length === 0 && summaries.length === 0) return;

    // Gather data from session knowledge
    const decisions = knowledge.filter((k) => k.category === "decision").map((k) => k.fact);
    const openQuestions = knowledge.filter((k) => k.category === "open_question").map((k) => k.fact);

    // Get topic and next steps from most recent summary
    const lastSummary = summaries[summaries.length - 1];
    const topic = lastSummary?.parsed.topic ?? knowledge[0]?.fact ?? "session";
    const nextSteps = lastSummary?.parsed.context_for_next ?? "";
    const codeChanges = lastSummary?.parsed.code_changes?.map((c) => `${c.file} — ${c.change}`) ?? [];

    let notesMd: string;
    try {
      const prompt = buildCheckpointPrompt(topic, decisions, openQuestions, nextSteps, codeChanges);
      const client = clientFromConfig(cfg.ollama.port);
      const result = await client.generate({
        model: cfg.model.active,
        prompt,
        system: CHECKPOINT_SYSTEM,
        temperature: 0.3,
        numCtx: 2048,
        numGpu: cfg.hardware.numGpu,
        timeoutMs: 45_000,
      });
      notesMd = result.response.trim();
      // Sanity check: must contain at least one markdown bold marker
      if (!notesMd.includes("**")) {
        notesMd = buildFallbackCheckpoint(topic, decisions, openQuestions, nextSteps);
      }
    } catch {
      // Ollama unavailable — use deterministic fallback
      notesMd = buildFallbackCheckpoint(topic, decisions, openQuestions, nextSteps);
    }

    if (!notesMd.trim()) return;

    saveCheckpoint({
      sessionId,
      projectPath: projectRoot(cwd),
      notesMd,
      createdAt: Date.now(),
    }, cwd);

    log.info(`cctx: session checkpoint saved for ${sessionId.slice(0, 8)}`);
  } catch (e) {
    log.warn(`cctx: checkpoint build failed: ${(e as Error).message}`);
    // Never throws — checkpoint is optional
  }
}
