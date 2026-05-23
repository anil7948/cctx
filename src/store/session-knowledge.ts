import { getDb } from "./db.js";
import type { KnowledgeCategory } from "./project-knowledge.js";

export interface SessionKnowledgeInput {
  sessionId: string;
  key: string;
  fact: string;
  category: KnowledgeCategory;
  sourceTurnIds: number[];
}

export interface SessionKnowledgeRow {
  id: number;
  session_id: string;
  key: string;
  fact: string;
  category: KnowledgeCategory;
  created_at: number;
  updated_at: number;
  source_turn_ids: string; // JSON array string stored in DB
}

export function listSessionKnowledge(sessionId: string, cwd: string = process.cwd()): SessionKnowledgeRow[] {
  const db = getDb(cwd);
  return db
    .prepare(`SELECT * FROM session_knowledge WHERE session_id = ? ORDER BY updated_at ASC`)
    .all(sessionId) as SessionKnowledgeRow[];
}

export function countSessionKnowledge(sessionId: string, cwd: string = process.cwd()): number {
  const db = getDb(cwd);
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM session_knowledge WHERE session_id = ?`).get(sessionId) as { n: number }
  ).n;
}

export function upsertSessionKnowledge(entry: SessionKnowledgeInput, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  const now = Date.now();

  // Merge source_turn_ids: union of existing and new
  const existing = db
    .prepare(`SELECT source_turn_ids FROM session_knowledge WHERE session_id = ? AND key = ?`)
    .get(entry.sessionId, entry.key) as { source_turn_ids: string } | undefined;
  const existingIds: number[] = existing ? (JSON.parse(existing.source_turn_ids) as number[]) : [];
  const mergedIds = [...new Set([...existingIds, ...entry.sourceTurnIds])];

  db.prepare(
    `INSERT INTO session_knowledge (session_id, key, fact, category, created_at, updated_at, source_turn_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, key) DO UPDATE SET
       fact            = excluded.fact,
       category        = excluded.category,
       updated_at      = excluded.updated_at,
       source_turn_ids = excluded.source_turn_ids`,
  ).run(entry.sessionId, entry.key, entry.fact, entry.category, now, now, JSON.stringify(mergedIds));
}

export function deleteSessionKnowledgeEntry(sessionId: string, key: string, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  db.prepare(`DELETE FROM session_knowledge WHERE session_id = ? AND key = ?`).run(sessionId, key);
}
