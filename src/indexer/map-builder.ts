import { listFileIndex, lastIndexRun } from "../store/file-index.js";
import { listProjectKnowledge } from "../store/project-knowledge.js";
import type { KnowledgeRow } from "../store/project-knowledge.js";
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

/** Maximum characters per page for get_codebase_context pagination.
 *  Claude Code's tool-result limit is ~100K chars; we use 80K to leave headroom. */
export const MAP_PAGE_SIZE_CHARS = 80_000;

/** Build the full project map and slice it into a page.
 *  page=1 (default) returns the first page.
 *  For small projects the full map fits in one page.
 *  For large projects, Claude should call repeatedly with page=2, page=3, etc. */
export function buildProjectMapPage(
  cwd: string = process.cwd(),
  page: number = 1,
): { text: string; page: number; totalPages: number; totalFiles: number } {
  const files = listFileIndex(cwd);
  const totalFiles = files.length;
  const lastRun = lastIndexRun(cwd);
  const projectName = basename(cwd);

  if (totalFiles === 0) {
    const text = `=== Project: ${projectName} (no index yet — run \`cctx index run\`) ===`;
    return { text, page: 1, totalPages: 1, totalFiles: 0 };
  }

  // Build per-file entry strings (same logic as buildProjectMap)
  const grouped = new Map<string, typeof files>();
  for (const f of files) {
    const dir = dirname(f.file_path);
    if (!grouped.has(dir)) grouped.set(dir, []);
    grouped.get(dir)!.push(f);
  }

  const fileEntries: string[] = [];
  const sortedDirs = [...grouped.keys()].sort();
  for (const dir of sortedDirs) {
    for (const f of grouped.get(dir)!) {
      const s = f.parsed;
      const lines: string[] = [f.file_path];
      if (s.purpose) lines.push(`  ${s.purpose}`);
      if (s.exports.length) lines.push(`  Exports: ${s.exports.join(", ")}`);
      if (s.side_effects.length) lines.push(`  Side effects: ${s.side_effects.join("; ")}`);
      if (s.notes) lines.push(`  Notes: ${s.notes}`);
      fileEntries.push(lines.join("\n"));
    }
  }

  // Build project memory block (always on last page or page 1 if fits)
  const knowledge = listProjectKnowledge(cwd);
  let memoryBlock = "";
  if (knowledge.length > 0) {
    const byCategory = new Map<string, KnowledgeRow[]>();
    for (const k of knowledge) {
      if (!byCategory.has(k.category)) byCategory.set(k.category, []);
      byCategory.get(k.category)!.push(k);
    }
    const lines = ["\n## Project Memory (cross-session)\n"];
    for (const [cat, entries] of byCategory) {
      lines.push(`### ${cat}`);
      for (const e of entries) lines.push(`- [${e.key}] ${e.fact}`);
    }
    memoryBlock = lines.join("\n");
  }

  const headerLine = lastRun
    ? `=== Project: ${projectName} (indexed ${formatRelativeTime(lastRun.ran_at)}, ${totalFiles} files) ===`
    : `=== Project: ${projectName} (${totalFiles} files) ===`;
  const footerLine = "To read any file in full, just ask — Claude Code will fetch it on demand.";

  // Pack file entries into pages, keeping each page under MAP_PAGE_SIZE_CHARS
  const pages: string[][] = [[]];
  let currentPageChars = headerLine.length + 2; // header + newline

  for (const entry of fileEntries) {
    const entryChars = entry.length + 1; // +1 for "\n" separator
    if (currentPageChars + entryChars > MAP_PAGE_SIZE_CHARS && pages[pages.length - 1].length > 0) {
      pages.push([]);
      currentPageChars = 0;
    }
    pages[pages.length - 1].push(entry);
    currentPageChars += entryChars;
  }

  const totalPages = pages.length;
  const idx = Math.max(0, Math.min(page - 1, totalPages - 1));
  const pageNum = idx + 1;
  const isLastPage = pageNum === totalPages;

  const parts: string[] = [];
  if (pageNum === 1) {
    parts.push(headerLine, "");
  } else {
    parts.push(`=== Project: ${projectName} — page ${pageNum} of ${totalPages} ===`, "");
  }

  parts.push(...pages[idx]);
  parts.push("");
  parts.push(footerLine);

  if (isLastPage && memoryBlock) {
    parts.push(memoryBlock);
  }

  const pageSuffix = totalPages > 1
    ? isLastPage
      ? `\n[Page ${pageNum}/${totalPages} — end of index]`
      : `\n[Page ${pageNum}/${totalPages} — call get_codebase_context(page=${pageNum + 1}) for next page]`
    : "";

  return { text: parts.join("\n") + pageSuffix, page: pageNum, totalPages, totalFiles };
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

  // Append cross-session project memory if any exists
  const knowledge = listProjectKnowledge(cwd);
  if (knowledge.length > 0) {
    const byCategory = new Map<string, KnowledgeRow[]>();
    for (const k of knowledge) {
      if (!byCategory.has(k.category)) byCategory.set(k.category, []);
      byCategory.get(k.category)!.push(k);
    }
    sections.push("");
    sections.push("## Project Memory (cross-session)\n");
    for (const [cat, entries] of byCategory) {
      sections.push(`### ${cat}`);
      for (const e of entries) {
        sections.push(`- [${e.key}] ${e.fact}`);
      }
    }
  }

  return sections.join("\n");
}
