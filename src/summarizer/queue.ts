import { listPendingTurns, markTurnSummarized } from "../store/turns.js";
import { saveSummary, listSummaries } from "../store/summaries.js";
import type { SummaryJson } from "../store/summaries.js";
import { summarizeTurn } from "./engine.js";
import { estimateTokensJson } from "../utils/tokenizer.js";
import { log } from "../utils/logger.js";
import { loadConfig } from "../utils/config.js";
import { listProjectKnowledge, upsertProjectKnowledge, pruneProjectKnowledge } from "../store/project-knowledge.js";
import type { KnowledgeEntry } from "../store/project-knowledge.js";
import { extractProjectKnowledge } from "../memory/knowledge-extractor.js";
import { consolidateSessionKnowledge } from "../memory/session-consolidator.js";

// ── Summarization queue ───────────────────────────────────────────────────────
// One in-flight summarization per session, processed serially. Concurrency
// against a local LLM is not free — phi3.5 saturates CPU/GPU on a single
// generate call. Serial keeps total wall time identical while avoiding
// thermal throttling and pid contention.
const inFlight = new Map<string, Promise<void>>();

// ── Consolidation queue ───────────────────────────────────────────────────────
// Chained serial queue for session knowledge consolidation — mirrors inFlight.
// Prevents TOCTOU races when multiple turns are batched in one summarization
// cycle: each consolidation sees the committed state of the previous one.
const consolidationInFlight = new Map<string, Promise<void>>();

function enqueueConsolidation(
  sessionId: string,
  summary: SummaryJson,
  turnId: number,
  cwd: string,
): void {
  const prev = consolidationInFlight.get(sessionId) ?? Promise.resolve();
  const next = prev
    .then(() => consolidateSessionKnowledge(summary, sessionId, turnId, cwd))
    .catch((e: Error) => log.warn(`Consolidation failed for turn ${turnId}: ${e.message}`))
    .finally(() => {
      if (consolidationInFlight.get(sessionId) === next) consolidationInFlight.delete(sessionId);
    });
  consolidationInFlight.set(sessionId, next);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function queueSummarization(sessionId: string, cwd: string = process.cwd()): Promise<void> {
  const existing = inFlight.get(sessionId);
  if (existing) return existing;

  const work = (async () => {
    try {
      const pending = listPendingTurns(sessionId, cwd);
      for (const turn of pending) {
        try {
          const summary = await summarizeTurn(turn.prompt, turn.response);
          const compressed = estimateTokensJson(summary);
          saveSummary({ sessionId, turnId: turn.id, summary, compressedTokensEst: compressed }, cwd);
          markTurnSummarized(turn.id, cwd);
          // Fire-and-forget consolidation — chained serially via consolidationInFlight
          // so concurrent turns don't race each other in the knowledge table.
          enqueueConsolidation(sessionId, summary, turn.id, cwd);
        } catch (e) {
          log.warn(`Failed to summarize turn ${turn.id}: ${(e as Error).message}`);
          // Leave summarized=0 so a future flush can retry.
        }
      }
    } finally {
      inFlight.delete(sessionId);
    }
  })();
  inFlight.set(sessionId, work);
  return work;
}

export async function flushSession(sessionId: string, cwd: string = process.cwd()): Promise<void> {
  // Step 1: flush pending turn summarizations
  await queueSummarization(sessionId, cwd);

  // Step 2: extract project-level knowledge from all session summaries (Feature 1)
  try {
    const cfg = loadConfig(cwd);
    if (!cfg.memory.enabled) return;

    const summaries = listSummaries(sessionId, cwd);
    if (summaries.length === 0) return;

    const existing = listProjectKnowledge(cwd);
    const actions = await extractProjectKnowledge(
      summaries.map((s) => s.parsed),
      existing,
      sessionId,
      cwd,
    );

    const now = Date.now();
    const toUpsert: KnowledgeEntry[] = actions
      .filter((a) => a.fact.length > 0)
      .map((a) => ({
        key: a.key,
        fact: a.fact,
        category: a.category,
        importance: a.importance,
        source_session: sessionId,
        created_at: now,
        updated_at: now,
      }));

    if (toUpsert.length > 0) {
      upsertProjectKnowledge(toUpsert, cwd);
      pruneProjectKnowledge(cfg.memory.maxProjectKnowledge, cwd);
    }
  } catch (e) {
    log.warn(`Project knowledge extraction failed: ${(e as Error).message}`);
    // Non-fatal — flush itself succeeded (turn summarizations are done)
  }
}
