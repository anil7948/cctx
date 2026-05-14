import { getDb } from "./db.js";
import { projectRoot } from "../utils/paths.js";

export interface FileIndexRow {
  id: number;
  project_path: string;
  file_path: string;
  file_mtime: number;
  file_size: number;
  summary_json: string;
  indexed_at: number;
}

export interface FileSummary {
  purpose: string;
  exports: string[];
  key_imports: string[];
  side_effects: string[];
  notes: string;
}

export function upsertFileIndex(args: {
  filePath: string;
  mtime: number;
  size: number;
  summary: FileSummary;
}, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  db.prepare(
    `INSERT INTO file_index (project_path, file_path, file_mtime, file_size, summary_json, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_path, file_path) DO UPDATE SET
       file_mtime = excluded.file_mtime,
       file_size = excluded.file_size,
       summary_json = excluded.summary_json,
       indexed_at = excluded.indexed_at`,
  ).run(
    projectRoot(cwd),
    args.filePath,
    args.mtime,
    args.size,
    JSON.stringify(args.summary),
    Date.now(),
  );
}

export function getFileIndex(filePath: string, cwd: string = process.cwd()): (FileIndexRow & { parsed: FileSummary }) | null {
  const db = getDb(cwd);
  const row = db
    .prepare(`SELECT * FROM file_index WHERE project_path = ? AND file_path = ?`)
    .get(projectRoot(cwd), filePath) as FileIndexRow | undefined;
  if (!row) return null;
  return { ...row, parsed: JSON.parse(row.summary_json) as FileSummary };
}

export function listFileIndex(cwd: string = process.cwd()): Array<FileIndexRow & { parsed: FileSummary }> {
  const db = getDb(cwd);
  const rows = db
    .prepare(`SELECT * FROM file_index WHERE project_path = ? ORDER BY file_path ASC`)
    .all(projectRoot(cwd)) as FileIndexRow[];
  return rows.map((r) => ({ ...r, parsed: JSON.parse(r.summary_json) as FileSummary }));
}

export function deleteMissingFiles(presentPaths: Set<string>, cwd: string = process.cwd()): number {
  const db = getDb(cwd);
  const existing = db
    .prepare(`SELECT file_path FROM file_index WHERE project_path = ?`)
    .all(projectRoot(cwd)) as Array<{ file_path: string }>;
  const stale = existing.filter((r) => !presentPaths.has(r.file_path));
  if (stale.length === 0) return 0;
  const stmt = db.prepare(`DELETE FROM file_index WHERE project_path = ? AND file_path = ?`);
  const tx = db.transaction(() => {
    for (const r of stale) stmt.run(projectRoot(cwd), r.file_path);
  });
  tx();
  return stale.length;
}

export function recordIndexRun(args: {
  filesIndexed: number;
  filesSkipped: number;
  durationMs: number;
}, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  db.prepare(
    `INSERT INTO index_runs (project_path, files_indexed, files_skipped, duration_ms, ran_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(projectRoot(cwd), args.filesIndexed, args.filesSkipped, args.durationMs, Date.now());
}

export function lastIndexRun(cwd: string = process.cwd()): { files_indexed: number; files_skipped: number; ran_at: number; duration_ms: number } | null {
  const db = getDb(cwd);
  const row = db
    .prepare(`SELECT files_indexed, files_skipped, ran_at, duration_ms FROM index_runs WHERE project_path = ? ORDER BY ran_at DESC LIMIT 1`)
    .get(projectRoot(cwd)) as { files_indexed: number; files_skipped: number; ran_at: number; duration_ms: number } | undefined;
  return row ?? null;
}
