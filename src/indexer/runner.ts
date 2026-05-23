import { readFileSync } from "node:fs";
import { walkProject } from "./walker.js";
import { summarizeFile } from "./file-summarizer.js";
import {
  upsertFileIndex,
  getFileIndex,
  deleteMissingFiles,
  recordIndexRun,
} from "../store/file-index.js";
import { projectRoot } from "../utils/paths.js";
import { log } from "../utils/logger.js";
import { loadConfig } from "../utils/config.js";

export interface IndexRunResult {
  filesIndexed: number;
  filesSkipped: number;
  filesRemoved: number;
  durationMs: number;
  failures: Array<{ path: string; error: string }>;
}

export interface IndexRunOptions {
  cwd?: string;
  /** Called for every file processed. `total` is the full file count for the run. */
  onFile?: (path: string, action: "indexed" | "skipped" | "failed", progress: { done: number; total: number }) => void;
  force?: boolean;
}

export async function runIndex(opts: IndexRunOptions = {}): Promise<IndexRunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = loadConfig(cwd);
  const root = projectRoot(cwd);
  const start = Date.now();
  const files = walkProject(root, cwd);

  const presentPaths = new Set(files.map((f) => f.relPath));
  const filesRemoved = deleteMissingFiles(presentPaths, cwd);

  let indexed = 0;
  let skipped = 0;
  let done = 0;
  const total = files.length;
  const failures: Array<{ path: string; error: string }> = [];

  // Separate files that need indexing from those that can be skipped upfront.
  // Skipped files are counted immediately; only the remaining files go into the pool.
  const toIndex: typeof files = [];
  for (const file of files) {
    if (!opts.force) {
      const existing = getFileIndex(file.relPath, cwd);
      if (existing && existing.file_mtime === file.mtime && existing.file_size === file.size) {
        skipped++;
        done++;
        opts.onFile?.(file.relPath, "skipped", { done, total });
        continue;
      }
    }
    toIndex.push(file);
  }

  // Parallel worker pool — N files in flight simultaneously.
  // Each worker pulls the next file from a shared queue until empty.
  // Chunks within each file are still processed serially (merge requires order).
  const concurrency = Math.max(1, cfg.hardware.indexingConcurrency);
  const queue = [...toIndex];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const file = queue.shift()!;
      done++;
      try {
        const content = readFileSync(file.absPath, "utf8");
        const summary = await summarizeFile(file.relPath, content);
        upsertFileIndex(
          { filePath: file.relPath, mtime: file.mtime, size: file.size, summary },
          cwd,
        );
        indexed++;
        opts.onFile?.(file.relPath, "indexed", { done, total });
      } catch (e) {
        const err = (e as Error).message;
        failures.push({ path: file.relPath, error: err });
        opts.onFile?.(file.relPath, "failed", { done, total });
        log.warn(`Index failed for ${file.relPath}: ${err}`);
      }
    }
  }

  const workerCount = Math.min(concurrency, toIndex.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const durationMs = Date.now() - start;
  recordIndexRun({ filesIndexed: indexed, filesSkipped: skipped, durationMs }, cwd);
  return { filesIndexed: indexed, filesSkipped: skipped, filesRemoved, durationMs, failures };
}
