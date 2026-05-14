import { watch } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { runIndex, type IndexRunResult } from "./runner.js";
import { loadConfig } from "../utils/config.js";
import { log } from "../utils/logger.js";

const DEBOUNCE_MS = 1500;

export interface WatchRunResult extends IndexRunResult {
  changedPaths: string[];
}

export function watchProject(
  root: string,
  cwd: string = process.cwd(),
  onComplete?: (result: WatchRunResult) => void,
): { stop: () => void } {
  const cfg = loadConfig(cwd);
  const exts = new Set(cfg.codebaseIndex.extensions);
  const excluded = new Set(cfg.codebaseIndex.excludeDirs);

  let pending: NodeJS.Timeout | null = null;
  let runScheduled = false;
  const pendingPaths = new Set<string>();

  const schedule = (relPath: string): void => {
    pendingPaths.add(relPath);
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      if (runScheduled) return;
      runScheduled = true;
      const changedPaths = [...pendingPaths];
      pendingPaths.clear();
      runIndex({ cwd })
        .then((r) => {
          log.info(`Background re-index: ${r.filesIndexed} indexed, ${r.filesSkipped} skipped`);
          if (onComplete) onComplete({ ...r, changedPaths });
        })
        .catch((e) => log.warn("Background re-index failed", e))
        .finally(() => {
          runScheduled = false;
        });
    }, DEBOUNCE_MS);
  };

  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString().split(sep).join("/");
    if (!rel) return;
    const top = rel.split("/")[0]!;
    if (excluded.has(top)) return;
    if (!exts.has(extname(rel).toLowerCase())) return;
    log.debug(`Detected change: ${join(root, rel)} (rel=${relative(root, join(root, rel))})`);
    schedule(rel);
  });

  return {
    stop: () => {
      if (pending) clearTimeout(pending);
      watcher.close();
    },
  };
}
