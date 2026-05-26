import { ensureDaemon } from "../ollama/manager.js";
import { loadConfig } from "../utils/config.js";
import { extractFirstJsonObject } from "../summarizer/json-extract.js";
import { FILE_INDEX_SYSTEM } from "./prompt.js";
import { chunkFile } from "./chunker.js";
import { extractStructural } from "./structural-extract.js";
import type { FileSummary } from "../store/file-index.js";

// SAFETY: structural fields (exports, key_imports, side_effects) are extracted
// deterministically by a regex pass in structural-extract.ts. The LLM is only
// asked for `purpose` and `notes` — advisory prose where hallucination is
// tolerable. A previous version asked the LLM for every field and it
// confidently invented exports that didn't exist, then those fabricated
// summaries were served to Claude via the cache-hit path of the Read
// compressor. Do not move structural extraction back into the LLM.

function coerceProse(raw: unknown): { purpose: string; notes: string } {
  if (!raw || typeof raw !== "object") return { purpose: "", notes: "" };
  const o = raw as Record<string, unknown>;
  return {
    purpose: String(o.purpose ?? "").trim(),
    notes: String(o.notes ?? "").trim(),
  };
}

function buildProsePrompt(filePath: string, chunk: string): string {
  // First 60 lines is enough to characterize the file. Sending less to the
  // model means less it can get wrong.
  const head = chunk.split("\n").slice(0, 60).join("\n");
  return (
    `Summarize this source file in two short fields.\n` +
    `File: ${filePath}\n` +
    "```\n" +
    head +
    "\n```\n" +
    `Respond ONLY with JSON: ` +
    `{"purpose":"one short sentence describing what the file does",` +
    `"notes":"one short sentence about any non-obvious decisions, or empty string"}`
  );
}

async function summarizeProse(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  model: string,
  filePath: string,
  chunk: string,
  numGpu: number,
): Promise<{ purpose: string; notes: string }> {
  try {
    const result = await client.generate({
      model,
      prompt: buildProsePrompt(filePath, chunk),
      system: FILE_INDEX_SYSTEM,
      temperature: 0.1,
      format: "json",
      numCtx: 8192,
      numGpu,
      timeoutMs: 45_000,
    });
    return coerceProse(extractFirstJsonObject(result.response));
  } catch {
    return { purpose: "", notes: "" };
  }
}

export async function summarizeFile(filePath: string, content: string): Promise<FileSummary> {
  const cfg = loadConfig();

  // Structural fields — deterministic, guaranteed accurate.
  const structural = extractStructural(filePath, content);

  // Prose fields — best-effort LLM. If the daemon is down or the model times
  // out we just return empty prose; the structural data is still useful.
  let prose = { purpose: "", notes: "" };
  try {
    const client = await ensureDaemon();
    const chunks = chunkFile(content);
    prose = await summarizeProse(
      client,
      cfg.model.active,
      filePath,
      chunks[0] ?? content,
      cfg.hardware.numGpu,
    );
  } catch {
    // proceed with structural-only summary
  }

  return {
    purpose: prose.purpose || "(no LLM summary available)",
    exports: structural.exports,
    key_imports: structural.key_imports,
    side_effects: structural.side_effects,
    notes: prose.notes,
  };
}
