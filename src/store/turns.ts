import { getDb } from "./db.js";

export interface TurnRow {
  id: number;
  session_id: string;
  turn_index: number;
  prompt: string;
  response: string;
  raw_tokens_est: number;
  summarized: number;
  created_at: number;
}

export function recordTurn(args: {
  sessionId: string;
  prompt: string;
  response: string;
  rawTokensEst: number;
}, cwd: string = process.cwd()): TurnRow {
  const db = getDb(cwd);
  const tx = db.transaction(() => {
    const next = db
      .prepare(`SELECT COALESCE(MAX(turn_index), -1) + 1 AS idx FROM turns WHERE session_id = ?`)
      .get(args.sessionId) as { idx: number };
    const info = db
      .prepare(
        `INSERT INTO turns (session_id, turn_index, prompt, response, raw_tokens_est, summarized, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(args.sessionId, next.idx, args.prompt, args.response, args.rawTokensEst, Date.now());
    return db.prepare(`SELECT * FROM turns WHERE id = ?`).get(info.lastInsertRowid) as TurnRow;
  });
  return tx();
}

export function listTurns(sessionId: string, cwd: string = process.cwd()): TurnRow[] {
  const db = getDb(cwd);
  return db
    .prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index ASC`)
    .all(sessionId) as TurnRow[];
}

export function listPendingTurns(sessionId: string, cwd: string = process.cwd()): TurnRow[] {
  const db = getDb(cwd);
  return db
    .prepare(`SELECT * FROM turns WHERE session_id = ? AND summarized = 0 ORDER BY turn_index ASC`)
    .all(sessionId) as TurnRow[];
}

export function markTurnSummarized(turnId: number, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  db.prepare(`UPDATE turns SET summarized = 1 WHERE id = ?`).run(turnId);
}
