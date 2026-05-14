import { statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../utils/config.js";
import { getFileIndex, type FileSummary } from "../store/file-index.js";
import { projectRoot } from "../utils/paths.js";
import { ensureDaemon } from "../ollama/manager.js";
import { TOOL_COMPRESS_SYSTEM, buildToolCompressPrompt } from "./prompt.js";
import type { CompressionInput } from "./types.js";

function renderCachedSummary(filePath: string, s: FileSummary): string {
  const parts: string[] = [`# ${filePath} (cached summary)`];
  if (s.purpose) parts.push(`Purpose: ${s.purpose}`);
  if (s.exports.length) parts.push(`Exports: ${s.exports.join(", ")}`);
  if (s.key_imports.length) parts.push(`Imports: ${s.key_imports.join(", ")}`);
  if (s.side_effects.length) parts.push(`Side effects: ${s.side_effects.join("; ")}`);
  if (s.notes) parts.push(`Notes: ${s.notes}`);
  parts.push("");
  parts.push("(File summarized from index; ask to read the full file if you need its body.)");
  return parts.join("\n");
}

function matchesPattern(path: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    if (pat.includes("*")) {
      const regex = new RegExp(
        "^" + pat.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$",
      );
      if (regex.test(path)) return true;
    } else if (pat === path) {
      return true;
    }
  }
  return false;
}

export async function compressFileRead(
  input: CompressionInput,
  cwd: string = process.cwd(),
): Promise<{ text: string; strategy: string }> {
  const cfg = loadConfig(cwd);
  const filePath = input.filePath;

  if (filePath && matchesPattern(filePath, cfg.toolCompression.alwaysRaw)) {
    return { text: input.rawOutput, strategy: "file:always-raw" };
  }

  const lineCount = input.rawOutput.split("\n").length;
  if (lineCount < cfg.toolCompression.fileMinLinesForLLMSummary) {
    return { text: input.rawOutput, strategy: "file:small-passthrough" };
  }

  // Cache-hit path: if the file is in our index and the on-disk mtime+size
  // match what we indexed, we know the cached summary is current.
  if (filePath) {
    const indexed = getFileIndex(filePath, cwd);
    if (indexed) {
      const abs = resolve(projectRoot(cwd), filePath);
      if (existsSync(abs)) {
        try {
          const stat = statSync(abs);
          const mtimeMatches = Math.floor(stat.mtimeMs) === indexed.file_mtime;
          if (mtimeMatches && stat.size === indexed.file_size) {
            return { text: renderCachedSummary(filePath, indexed.parsed), strategy: "file:cache-hit" };
          }
        } catch {
          // fall through to LLM
        }
      }
    }
  }

  const client = await ensureDaemon();
  const result = await client.generate({
    model: cfg.model.active,
    prompt: buildToolCompressPrompt(filePath ?? "file_read", input.rawOutput),
    system: TOOL_COMPRESS_SYSTEM,
    temperature: 0.1,
    numCtx: 8192,
    timeoutMs: 45_000,
  });
  return { text: result.response.trim(), strategy: "file:llm" };
}
