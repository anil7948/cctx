import { getDb } from "./db.js";
import { projectRoot } from "../utils/paths.js";

export interface CheckpointEntry {
  sessionId: string;
  projectPath: string;
  notesMd: string;
  createdAt: number;
}

export interface CheckpointRow extends CheckpointEntry {
  id: number;
}

export function saveCheckpoint(entry: CheckpointEntry, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  db.prepare(
    `INSERT INTO session_checkpoints (session_id, project_path, notes_md, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(entry.sessionId, entry.projectPath, entry.notesMd, entry.createdAt);
}

/** Get the most recent checkpoint for this project (across all sessions). */
export function getLatestCheckpoint(cwd: string = process.cwd()): CheckpointRow | null {
  const db = getDb(cwd);
  const row = db.prepare(
    `SELECT id, session_id, project_path, notes_md, created_at
     FROM session_checkpoints
     WHERE project_path = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get(projectRoot(cwd)) as { id: number; session_id: string; project_path: string; notes_md: string; created_at: number } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    projectPath: row.project_path,
    notesMd: row.notes_md,
    createdAt: row.created_at,
  };
}

/** Get the checkpoint for a specific session. */
export function getSessionCheckpoint(sessionId: string, cwd: string = process.cwd()): CheckpointRow | null {
  const db = getDb(cwd);
  const row = db.prepare(
    `SELECT id, session_id, project_path, notes_md, created_at
     FROM session_checkpoints
     WHERE session_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get(sessionId) as { id: number; session_id: string; project_path: string; notes_md: string; created_at: number } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    projectPath: row.project_path,
    notesMd: row.notes_md,
    createdAt: row.created_at,
  };
}
