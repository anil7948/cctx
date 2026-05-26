import { statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../utils/config.js";
import { getFileIndex, type FileSummary } from "../store/file-index.js";
import { projectRoot } from "../utils/paths.js";
import type { CompressionInput } from "./types.js";

// SAFETY: this module never sends source code to an LLM. The cache-hit path
// renders a deterministic summary built by the indexer; otherwise we pass the
// raw file through untouched. A previous version sent unindexed files to a
// small local model for "compression" and the model hallucinated invalid code
// that then replaced the real file in Claude's context window. Do not bring
// that path back without a way to guarantee identifier preservation.

const SUMMARY_BANNER =
  "[cctx: cached index summary — NOT the file body. " +
  "If you need the file contents, re-read with a different path, " +
  "or add the path to toolCompression.alwaysRaw in ~/.cctx/config.json.]";

function renderCachedSummary(filePath: string, s: FileSummary): string {
  const parts: string[] = [SUMMARY_BANNER, "", `# ${filePath} (cached summary)`];
  if (s.purpose) parts.push(`Purpose: ${s.purpose}`);
  if (s.exports.length) parts.push(`Exports: ${s.exports.join(", ")}`);
  if (s.key_imports.length) parts.push(`Imports: ${s.key_imports.join(", ")}`);
  if (s.side_effects.length) parts.push(`Side effects: ${s.side_effects.join("; ")}`);
  if (s.notes) parts.push(`Notes: ${s.notes}`);
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

  // Cache-hit path: only return the deterministic summary when the on-disk
  // mtime+size match what the indexer recorded. Otherwise pass raw — never
  // synthesize content. The mtime check uses Math.floor to match what
  // walker.ts stores (Math.floor(stat.mtimeMs)).
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
          // fall through to raw
        }
      }
    }
  }

  return { text: input.rawOutput, strategy: "file:raw" };
}
