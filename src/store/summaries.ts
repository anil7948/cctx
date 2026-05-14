import { getDb } from "./db.js";

export interface SummaryRow {
  id: number;
  session_id: string;
  turn_id: number;
  summary_json: string;
  compressed_tokens_est: number;
  summarized_at: number;
}

export interface SummaryJson {
  topic: string;
  decisions: string[];
  code_changes: Array<{ file: string; change: string }>;
  symbols: string[];
  errors_resolved: string[];
  open_questions: string[];
  context_for_next: string;
}

export function saveSummary(args: {
  sessionId: string;
  turnId: number;
  summary: SummaryJson;
  compressedTokensEst: number;
}, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  db.prepare(
    `INSERT INTO summaries (session_id, turn_id, summary_json, compressed_tokens_est, summarized_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(turn_id) DO UPDATE SET
       summary_json = excluded.summary_json,
       compressed_tokens_est = excluded.compressed_tokens_est,
       summarized_at = excluded.summarized_at`,
  ).run(
    args.sessionId,
    args.turnId,
    JSON.stringify(args.summary),
    args.compressedTokensEst,
    Date.now(),
  );
}

export function listSummaries(sessionId: string, cwd: string = process.cwd()): Array<SummaryRow & { parsed: SummaryJson }> {
  const db = getDb(cwd);
  const rows = db
    .prepare(
      `SELECT s.* FROM summaries s
       JOIN turns t ON t.id = s.turn_id
       WHERE s.session_id = ?
       ORDER BY t.turn_index ASC`,
    )
    .all(sessionId) as SummaryRow[];
  return rows.map((r) => ({ ...r, parsed: JSON.parse(r.summary_json) as SummaryJson }));
}
