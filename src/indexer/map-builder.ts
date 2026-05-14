import { listFileIndex, lastIndexRun } from "../store/file-index.js";
import { basename, dirname } from "node:path";

function formatRelativeTime(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function buildProjectMap(cwd: string = process.cwd()): string {
  const files = listFileIndex(cwd);
  const lastRun = lastIndexRun(cwd);
  const projectName = basename(cwd);

  if (files.length === 0) {
    return `=== Project: ${projectName} (no index yet — run \`cctx index run\`) ===`;
  }

  const header = lastRun
    ? `=== Project: ${projectName} (indexed ${formatRelativeTime(lastRun.ran_at)}, ${files.length} files) ===`
    : `=== Project: ${projectName} (${files.length} files) ===`;

  const grouped = new Map<string, typeof files>();
  for (const f of files) {
    const dir = dirname(f.file_path);
    if (!grouped.has(dir)) grouped.set(dir, []);
    grouped.get(dir)!.push(f);
  }

  const sections: string[] = [header, ""];
  const sortedDirs = [...grouped.keys()].sort();
  for (const dir of sortedDirs) {
    const dirFiles = grouped.get(dir)!;
    for (const f of dirFiles) {
      const s = f.parsed;
      const lines: string[] = [f.file_path];
      if (s.purpose) lines.push(`  ${s.purpose}`);
      if (s.exports.length) lines.push(`  Exports: ${s.exports.join(", ")}`);
      if (s.side_effects.length) lines.push(`  Side effects: ${s.side_effects.join("; ")}`);
      if (s.notes) lines.push(`  Notes: ${s.notes}`);
      sections.push(lines.join("\n"));
    }
  }
  sections.push("");
  sections.push("To read any file in full, just ask — Claude Code will fetch it on demand.");
  return sections.join("\n");
}
