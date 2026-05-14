import ora from "ora";
import { runIndex } from "../indexer/runner.js";
import { lastIndexRun, listFileIndex } from "../store/file-index.js";
import { walkProject } from "../indexer/walker.js";
import { watchProject } from "../indexer/watcher.js";
import { projectRoot } from "../utils/paths.js";
import { fmt } from "./format.js";

export async function indexRun(opts: { path?: string; force?: boolean }): Promise<void> {
  const cwd = opts.path ? opts.path : process.cwd();
  const spinner = ora("Scanning project files...").start();
  const result = await runIndex({
    cwd,
    force: opts.force,
    onFile: (path, action, progress) => {
      if (action === "indexed" || action === "failed") {
        spinner.text = `Indexing (${progress.done}/${progress.total}): ${path}`;
      }
    },
  });
  spinner.succeed(
    `${result.filesIndexed} indexed, ${result.filesSkipped} unchanged, ${result.filesRemoved} removed in ${(result.durationMs / 1000).toFixed(1)}s`,
  );
  if (result.failures.length > 0) {
    console.log(fmt.warn(`${result.failures.length} files failed:`));
    for (const f of result.failures.slice(0, 5)) {
      console.log(`  - ${f.path}: ${f.error}`);
    }
    if (result.failures.length > 5) console.log(`  (and ${result.failures.length - 5} more)`);
  }
}

export function indexStatus(): void {
  const last = lastIndexRun();
  const indexed = listFileIndex();
  const present = walkProject(projectRoot());
  const byPath = new Map(indexed.map((f) => [f.file_path, f]));
  let pending = 0;
  for (const f of present) {
    const cached = byPath.get(f.relPath);
    if (!cached || cached.file_mtime !== f.mtime || cached.file_size !== f.size) pending++;
  }
  console.log(`Indexed files:    ${indexed.length}`);
  console.log(`Files on disk:    ${present.length}`);
  console.log(`Pending changes:  ${pending}`);
  if (last) {
    console.log(`Last run:         ${new Date(last.ran_at).toISOString()} (${(last.duration_ms / 1000).toFixed(1)}s, ${last.files_indexed} indexed)`);
  } else {
    console.log(`Last run:         never`);
  }
}

export async function indexWatch(opts: { path?: string }): Promise<void> {
  const cwd = opts.path ? opts.path : process.cwd();
  const root = projectRoot(cwd);
  console.log(fmt.info(`Watching ${root} for changes (Ctrl-C to stop)`));

  const handle = watchProject(root, cwd, (result) => {
    if (result.filesIndexed > 0 || result.failures.length > 0) {
      const changedPaths = result.changedPaths.slice(0, 3).join(", ");
      const suffix = result.changedPaths.length > 3
        ? ` (+${result.changedPaths.length - 3} more)`
        : "";
      console.log(
        fmt.ok(
          `Re-indexed ${result.filesIndexed} file${result.filesIndexed !== 1 ? "s" : ""} — ${changedPaths}${suffix}`,
        ),
      );
      if (result.failures.length > 0) {
        console.log(fmt.warn(`${result.failures.length} file(s) failed to index`));
      }
    }
  });

  process.on("SIGINT", () => {
    handle.stop();
    console.log("\n" + fmt.ok("Stopped"));
    process.exit(0);
  });
  // Block forever.
  await new Promise(() => undefined);
}
