import { getDb } from "./db.js";

export type KnowledgeCategory = "decision" | "pattern" | "bug" | "open_question" | "context";

export interface KnowledgeEntry {
  key: string;
  fact: string;
  category: KnowledgeCategory;
  source_session: string;
  created_at: number;
  updated_at: number;
  importance: number;
}

export interface KnowledgeRow extends KnowledgeEntry {
  id: number;
}

export function listProjectKnowledge(cwd: string = process.cwd()): KnowledgeRow[] {
  const db = getDb(cwd);
  return db
    .prepare(`SELECT * FROM project_knowledge ORDER BY importance DESC, updated_at DESC`)
    .all() as KnowledgeRow[];
}

export function upsertProjectKnowledge(entries: KnowledgeEntry[], cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  const stmt = db.prepare(
    `INSERT INTO project_knowledge (key, fact, category, source_session, created_at, updated_at, importance)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       fact           = excluded.fact,
       category       = excluded.category,
       source_session = excluded.source_session,
       updated_at     = excluded.updated_at,
       importance     = excluded.importance`,
  );
  const tx = db.transaction(() => {
    for (const e of entries) {
      stmt.run(e.key, e.fact, e.category, e.source_session, e.created_at, e.updated_at, e.importance);
    }
  });
  tx();
}

export function pruneProjectKnowledge(maxEntries: number, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM project_knowledge`).get() as { n: number }).n;
  if (count <= maxEntries) return;
  const excess = count - maxEntries;
  db.prepare(
    `DELETE FROM project_knowledge WHERE id IN (
       SELECT id FROM project_knowledge ORDER BY importance ASC, updated_at ASC LIMIT ?
     )`,
  ).run(excess);
}
