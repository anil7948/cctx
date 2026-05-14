import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { projectRoot } from "../utils/paths.js";

export interface SessionRow {
  id: string;
  project_path: string;
  created_at: number;
  last_active: number;
  model_used: string | null;
}

const NEW_SESSION_GAP_MS = 30 * 60 * 1000;

export function createSession(model: string | null, cwd: string = process.cwd()): SessionRow {
  const db = getDb(cwd);
  const now = Date.now();
  const id = randomUUID();
  const row: SessionRow = {
    id,
    project_path: projectRoot(cwd),
    created_at: now,
    last_active: now,
    model_used: model,
  };
  db.prepare(
    `INSERT INTO sessions (id, project_path, created_at, last_active, model_used) VALUES (?, ?, ?, ?, ?)`,
  ).run(row.id, row.project_path, row.created_at, row.last_active, row.model_used);
  db.prepare(`INSERT INTO session_stats (session_id) VALUES (?)`).run(row.id);
  return row;
}

export function getOrCreateActiveSession(model: string | null, cwd: string = process.cwd()): SessionRow {
  const db = getDb(cwd);
  const row = db
    .prepare(
      `SELECT * FROM sessions WHERE project_path = ? ORDER BY last_active DESC LIMIT 1`,
    )
    .get(projectRoot(cwd)) as SessionRow | undefined;

  if (row && Date.now() - row.last_active < NEW_SESSION_GAP_MS) {
    touchSession(row.id, cwd);
    return row;
  }
  return createSession(model, cwd);
}

export function touchSession(id: string, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  db.prepare(`UPDATE sessions SET last_active = ? WHERE id = ?`).run(Date.now(), id);
}

export function listSessions(cwd: string = process.cwd()): SessionRow[] {
  const db = getDb(cwd);
  return db
    .prepare(`SELECT * FROM sessions WHERE project_path = ? ORDER BY last_active DESC`)
    .all(projectRoot(cwd)) as SessionRow[];
}

export function getSession(id: string, cwd: string = process.cwd()): SessionRow | null {
  const db = getDb(cwd);
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
  return row ?? null;
}
