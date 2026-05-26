import Database from "better-sqlite3";
import type { Database as SqliteDb } from "better-sqlite3";
import { projectDbPath, ensureProjectDirs } from "../utils/paths.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL,
  model_used TEXT
);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  raw_tokens_est INTEGER NOT NULL,
  summarized INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_turns_pending ON turns(session_id, summarized);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_id INTEGER NOT NULL UNIQUE,
  summary_json TEXT NOT NULL,
  compressed_tokens_est INTEGER NOT NULL,
  summarized_at INTEGER NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES turns(id)
);

CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);

CREATE TABLE IF NOT EXISTS file_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_mtime INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  UNIQUE(project_path, file_path)
);

CREATE INDEX IF NOT EXISTS idx_file_index_project ON file_index(project_path);

CREATE TABLE IF NOT EXISTS index_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  files_indexed INTEGER NOT NULL,
  files_skipped INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  ran_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_compressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool_type TEXT NOT NULL,
  raw_tokens_est INTEGER NOT NULL,
  compressed_tokens_est INTEGER NOT NULL,
  strategy TEXT NOT NULL,
  compressed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_comp_session ON tool_compressions(session_id);

CREATE TABLE IF NOT EXISTS session_stats (
  session_id TEXT PRIMARY KEY,
  raw_tokens_total INTEGER NOT NULL DEFAULT 0,
  compressed_tokens_total INTEGER NOT NULL DEFAULT 0,
  layer1_savings INTEGER NOT NULL DEFAULT 0,
  layer2_savings INTEGER NOT NULL DEFAULT 0,
  layer3_savings INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_knowledge (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  key            TEXT NOT NULL UNIQUE,
  fact           TEXT NOT NULL,
  category       TEXT NOT NULL CHECK(category IN ('decision','pattern','bug','open_question','context')),
  source_session TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  importance     INTEGER NOT NULL DEFAULT 3
);

CREATE INDEX IF NOT EXISTS idx_project_knowledge_importance
  ON project_knowledge(importance DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS session_knowledge (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL,
  key             TEXT NOT NULL,
  fact            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK(category IN ('decision','pattern','bug','open_question','context')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  source_turn_ids TEXT NOT NULL DEFAULT '[]',
  UNIQUE(session_id, key),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_session_knowledge_session
  ON session_knowledge(session_id);

CREATE TABLE IF NOT EXISTS session_checkpoints (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  project_path TEXT NOT NULL,
  notes_md     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_project
  ON session_checkpoints(project_path, created_at DESC);
`;

const CURRENT_VERSION = 4;

const connections = new Map<string, SqliteDb>();

export function getDb(cwd: string = process.cwd()): SqliteDb {
  ensureProjectDirs(cwd);
  const path = projectDbPath(cwd);
  const cached = connections.get(path);
  if (cached) return cached;

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const versionRow = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
  if (!versionRow) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_VERSION);
  } else if (versionRow.version < CURRENT_VERSION) {
    db.transaction(() => {
      if (versionRow.version < 2) {
        // Migration v1 → v2: add project_knowledge and session_knowledge tables.
        // IF NOT EXISTS guards make this safe even if SCHEMA already ran on a fresh DB.
        db.exec(`
          CREATE TABLE IF NOT EXISTS project_knowledge (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            key            TEXT NOT NULL UNIQUE,
            fact           TEXT NOT NULL,
            category       TEXT NOT NULL CHECK(category IN ('decision','pattern','bug','open_question','context')),
            source_session TEXT NOT NULL,
            created_at     INTEGER NOT NULL,
            updated_at     INTEGER NOT NULL,
            importance     INTEGER NOT NULL DEFAULT 3
          );
          CREATE INDEX IF NOT EXISTS idx_project_knowledge_importance
            ON project_knowledge(importance DESC, updated_at DESC);
          CREATE TABLE IF NOT EXISTS session_knowledge (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id      TEXT NOT NULL,
            key             TEXT NOT NULL,
            fact            TEXT NOT NULL,
            category        TEXT NOT NULL CHECK(category IN ('decision','pattern','bug','open_question','context')),
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            source_turn_ids TEXT NOT NULL DEFAULT '[]',
            UNIQUE(session_id, key),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
          );
          CREATE INDEX IF NOT EXISTS idx_session_knowledge_session
            ON session_knowledge(session_id);
        `);
        db.prepare("UPDATE schema_version SET version = 2").run();
      }
      if (versionRow.version < 3) {
        // Migration v2 → v3: invalidate all existing file_index rows.
        //
        // Prior versions of the indexer asked a small local LLM to extract
        // exports/imports/side_effects from each file. The model frequently
        // hallucinated entries (imports listed as exports, internal helpers
        // listed as exports). Those wrong summaries were then served via
        // the Read compressor's cache-hit path, so Claude would see invented
        // file APIs and route edits incorrectly.
        //
        // v3 ships with a deterministic structural extractor. To stop
        // serving stale hallucinated rows we wipe file_index on upgrade —
        // the next `cctx index run` will repopulate with correct data.
        // Truncating is safe: the table is a derived cache, not source of
        // truth.
        db.exec("DELETE FROM file_index;");
        db.prepare("UPDATE schema_version SET version = 3").run();
      }
      if (versionRow.version < 4) {
        // Migration v3 → v4: add session_checkpoints table and FTS5 index on file_index.
        db.exec(`
          CREATE TABLE IF NOT EXISTS session_checkpoints (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id   TEXT NOT NULL,
            project_path TEXT NOT NULL,
            notes_md     TEXT NOT NULL,
            created_at   INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
          );
          CREATE INDEX IF NOT EXISTS idx_checkpoints_project
            ON session_checkpoints(project_path, created_at DESC);
        `);
        // FTS5 content table referencing file_index rows.
        // We use a content table (not a shadow table) so we control inserts/deletes.
        // On migration, populate from whatever rows are currently in file_index.
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS file_index_fts USING fts5(
            file_path UNINDEXED,
            purpose,
            exports,
            notes,
            content='',
            tokenize='unicode61'
          );
        `);
        // Populate FTS from any existing file_index rows (may be empty after v3 truncation)
        const existing = db.prepare("SELECT id, file_path, summary_json FROM file_index").all() as Array<{id: number; file_path: string; summary_json: string}>;
        const ftsInsert = db.prepare("INSERT INTO file_index_fts(rowid, file_path, purpose, exports, notes) VALUES (?, ?, ?, ?, ?)");
        const populateFts = db.transaction(() => {
          for (const row of existing) {
            try {
              const s = JSON.parse(row.summary_json) as { purpose?: string; exports?: string[]; notes?: string };
              ftsInsert.run(row.id, row.file_path, s.purpose ?? "", Array.isArray(s.exports) ? s.exports.join(" ") : "", s.notes ?? "");
            } catch { /* skip malformed rows */ }
          }
        });
        populateFts();
        db.prepare("UPDATE schema_version SET version = 4").run();
      }
    })();
  }

  connections.set(path, db);
  return db;
}

export function closeAll(): void {
  for (const db of connections.values()) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  connections.clear();
}
