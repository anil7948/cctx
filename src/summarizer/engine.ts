import { ensureDaemon } from "../ollama/manager.js";
import { loadConfig } from "../utils/config.js";
import { log } from "../utils/logger.js";
import { TURN_SUMMARY_SYSTEM, buildTurnSummaryPrompt } from "./prompt.js";
import { extractFirstJsonObject } from "./json-extract.js";
import type { SummaryJson } from "../store/summaries.js";

function coerceSummary(raw: unknown): SummaryJson {
  if (!raw || typeof raw !== "object") throw new Error("Summary is not an object");
  const o = raw as Record<string, unknown>;
  // Provide sensible defaults for missing fields — small models like phi3.5 sometimes omit fields
  return {
    topic: String(o.topic ?? "").trim() || "unspecified",
    decisions: Array.isArray(o.decisions) ? o.decisions.map(String).filter(Boolean) : [],
    code_changes: Array.isArray(o.code_changes)
      ? (o.code_changes as Array<Record<string, unknown>>)
          .map((c) => ({
            file: String(c.file ?? "").trim(),
            change: String(c.change ?? "").trim(),
          }))
          .filter((c) => c.file && c.change)
      : [],
    symbols: Array.isArray(o.symbols) ? o.symbols.map(String).filter(Boolean) : [],
    errors_resolved: Array.isArray(o.errors_resolved) ? o.errors_resolved.map(String).filter(Boolean) : [],
    open_questions: Array.isArray(o.open_questions) ? o.open_questions.map(String).filter(Boolean) : [],
    context_for_next: String(o.context_for_next ?? "").trim() || "none",
  };
}

export async function summarizeTurn(prompt: string, response: string): Promise<SummaryJson> {
  const cfg = loadConfig();
  const client = await ensureDaemon();
  const promptText = buildTurnSummaryPrompt(prompt, response);

  // Two attempts: first with `format: "json"` (which Ollama enforces server-side
  // on models that support it), then a fallback without that flag in case the
  // model returns an empty/error response for the constrained mode.
  const attempts = [
    { format: "json" as const, temperature: 0.1 },
    { format: undefined, temperature: 0.2 },
  ];
  let lastErr: unknown;
  for (const a of attempts) {
    try {
      const result = await client.generate({
        model: cfg.model.active,
        prompt: promptText,
        system: TURN_SUMMARY_SYSTEM,
        temperature: a.temperature,
        format: a.format,
        numCtx: 8192,
        numGpu: cfg.hardware.numGpu,
        timeoutMs: 60_000,
      });
      const parsed = extractFirstJsonObject(result.response);
      return coerceSummary(parsed);
    } catch (e) {
      lastErr = e;
      log.warn(`summarizeTurn attempt failed: ${(e as Error).message}`);
    }
  }
  throw new Error(`summarizeTurn failed after retries: ${(lastErr as Error)?.message ?? "unknown"}`);
}
