import { ensureDaemon } from "../ollama/manager.js";
import { loadConfig } from "../utils/config.js";
import { extractFirstJsonObject } from "../summarizer/json-extract.js";
import { FILE_INDEX_SYSTEM, buildFileIndexPrompt } from "./prompt.js";
import { chunkFile } from "./chunker.js";
import type { FileSummary } from "../store/file-index.js";

function coerce(raw: unknown): FileSummary {
  if (!raw || typeof raw !== "object") throw new Error("File summary is not an object");
  const o = raw as Record<string, unknown>;
  // Provide sensible defaults for missing fields — small models like phi3.5 sometimes omit fields
  return {
    purpose: String(o.purpose ?? "").trim() || "unknown purpose",
    exports: Array.isArray(o.exports) ? o.exports.map(String).filter(Boolean) : [],
    key_imports: Array.isArray(o.key_imports) ? o.key_imports.map(String).filter(Boolean) : [],
    side_effects: Array.isArray(o.side_effects) ? o.side_effects.map(String).filter(Boolean) : [],
    notes: String(o.notes ?? "").trim() || "none",
  };
}

function mergeChunkSummaries(chunks: FileSummary[]): FileSummary {
  const exports = new Set<string>();
  const imports = new Set<string>();
  const sideEffects = new Set<string>();
  const notes: string[] = [];
  const purposes: string[] = [];
  for (const c of chunks) {
    if (c.purpose) purposes.push(c.purpose);
    for (const e of c.exports) exports.add(e);
    for (const i of c.key_imports) imports.add(i);
    for (const s of c.side_effects) sideEffects.add(s);
    if (c.notes) notes.push(c.notes);
  }
  return {
    purpose: purposes[0] ?? "",
    exports: [...exports],
    key_imports: [...imports],
    side_effects: [...sideEffects],
    notes: notes.join(" "),
  };
}

function buildMinimalPrompt(filePath: string, chunk: string): string {
  // Take only the first 40 lines — enough to see package, imports, and top-level declarations.
  // Used as a fallback when the full chunk causes the model to truncate its JSON output.
  const head = chunk.split("\n").slice(0, 40).join("\n");
  return `Summarize this file header. File: ${filePath}\n\`\`\`\n${head}\n\`\`\`\nRespond ONLY with JSON: {"purpose":"one sentence","exports":["..."],"key_imports":["..."],"side_effects":[],"notes":"none"}`;
}

async function summarizeChunk(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  model: string,
  filePath: string,
  chunk: string,
  numGpu: number,
): Promise<FileSummary> {
  const generate = (prompt: string) =>
    client.generate({
      model,
      prompt,
      system: FILE_INDEX_SYSTEM,
      temperature: 0.1,
      format: "json",
      numCtx: 16384,
      numGpu,
      timeoutMs: 90_000,
    });

  // First attempt with full chunk
  try {
    const result = await generate(buildFileIndexPrompt(filePath, chunk));
    return coerce(extractFirstJsonObject(result.response));
  } catch {
    // Retry with only the file header — far fewer input tokens, much less chance of truncation
    const result = await generate(buildMinimalPrompt(filePath, chunk));
    return coerce(extractFirstJsonObject(result.response));
  }
}

export async function summarizeFile(filePath: string, content: string): Promise<FileSummary> {
  const cfg = loadConfig();
  const client = await ensureDaemon();
  const chunks = chunkFile(content);

  const partials: FileSummary[] = [];
  for (const chunk of chunks) {
    const summary = await summarizeChunk(client, cfg.model.active, filePath, chunk, cfg.hardware.numGpu);
    partials.push(summary);
  }

  return partials.length === 1 ? partials[0]! : mergeChunkSummaries(partials);
}
