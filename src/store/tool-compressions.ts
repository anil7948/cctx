import { getDb } from "./db.js";

export interface ToolCompressionRow {
  id: number;
  session_id: string;
  tool_type: string;
  raw_tokens_est: number;
  compressed_tokens_est: number;
  strategy: string;
  compressed_at: number;
}

export function recordCompression(args: {
  sessionId: string;
  toolType: string;
  rawTokensEst: number;
  compressedTokensEst: number;
  strategy: string;
}, cwd: string = process.cwd()): void {
  const db = getDb(cwd);
  db.prepare(
    `INSERT INTO tool_compressions (session_id, tool_type, raw_tokens_est, compressed_tokens_est, strategy, compressed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    args.sessionId,
    args.toolType,
    args.rawTokensEst,
    args.compressedTokensEst,
    args.strategy,
    Date.now(),
  );
}

export interface CompressionStats {
  byTool: Array<{ tool_type: string; calls: number; raw: number; compressed: number; saved: number }>;
  total: { calls: number; raw: number; compressed: number; saved: number };
}

export function compressionStatsForSession(sessionId: string, cwd: string = process.cwd()): CompressionStats {
  const db = getDb(cwd);
  const rows = db
    .prepare(
      `SELECT tool_type,
              COUNT(*) AS calls,
              SUM(raw_tokens_est) AS raw,
              SUM(compressed_tokens_est) AS compressed
       FROM tool_compressions
       WHERE session_id = ?
       GROUP BY tool_type
       ORDER BY raw DESC`,
    )
    .all(sessionId) as Array<{ tool_type: string; calls: number; raw: number; compressed: number }>;
  const byTool = rows.map((r) => ({ ...r, saved: r.raw - r.compressed }));
  const total = byTool.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      raw: acc.raw + r.raw,
      compressed: acc.compressed + r.compressed,
      saved: acc.saved + r.saved,
    }),
    { calls: 0, raw: 0, compressed: 0, saved: 0 },
  );
  return { byTool, total };
}
