import { listPendingTurns, markTurnSummarized } from "../store/turns.js";
import { saveSummary } from "../store/summaries.js";
import { summarizeTurn } from "./engine.js";
import { estimateTokensJson } from "../utils/tokenizer.js";
import { log } from "../utils/logger.js";

// One in-flight summarization per session, processed serially. Concurrency
// against a local LLM is not free — phi3.5 saturates CPU/GPU on a single
// generate call. Serial keeps total wall time identical while avoiding
// thermal throttling and pid contention.
const inFlight = new Map<string, Promise<void>>();

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
  await queueSummarization(sessionId, cwd);
}
