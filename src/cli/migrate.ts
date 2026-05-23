/**
 * Background migration runner.
 *
 * Called by:
 *   1. The npm `postinstall` script (via `cctx _migrate`) — runs once after every
 *      `npm install -g cctx-optimizer`, finds all existing project DBs and silently
 *      migrates them to the current schema version.
 *   2. The MCP server startup — ensures the active project is migrated before any
 *      tool call, in case postinstall was skipped (e.g. manual binary copy).
 *
 * Design principles:
 *   - Never throws — all errors are swallowed so callers are never disrupted.
 *   - Never blocks user-facing operations — called fire-and-forget from postinstall
 *     and non-blocking from MCP server startup.
 *   - Idempotent — calling it multiple times is safe (IF NOT EXISTS guards in SQL).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { getDb } from "../store/db.js";
import { log } from "../utils/logger.js";

/**
 * Find all cctx project databases on the machine by scanning for `sessions.db`
 * files nested inside `.cctx` directories, depth-limited to avoid full-disk scan.
 *
 * Search strategy:
 *   - Start from $HOME
 *   - Max depth 8 (covers $HOME/dev/company/repo/.cctx/sessions.db comfortably)
 *   - Skip hidden dirs (except .cctx itself), node_modules, dist, .git
 *   - Use `find` (available on macOS and Linux); graceful fallback on Windows.
 */
function findAllProjectDbs(): string[] {
  const home = homedir();
  try {
    // Use spawnSync instead of execSync so that permission-denied errors from
    // inaccessible dirs (~/Library on macOS, etc.) don't throw — find exits
    // with code 1 in those cases even though stdout has valid results.
    const result = spawnSync(
      "find",
      [
        home,
        "-maxdepth", "8",
        "-name", "sessions.db",
        "-path", "*/.cctx/sessions.db",
        "-not", "-path", "*/node_modules/*",
        "-not", "-path", "*/.git/*",
        "-not", "-path", "*/dist/*",
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    // Use stdout regardless of exit code — partial results are fine
    const out = (result.stdout ?? "").trim();
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    // `find` not available or timed out — best effort, return empty
    return [];
  }
}

/**
 * Migrate a single project DB by opening it through getDb().
 * getDb() runs the schema migration automatically on connection.
 * Returns true if successful, false if the DB was unreachable or corrupt.
 */
function migrateDb(dbPath: string): boolean {
  try {
    // getDb() takes cwd, not a direct DB path.
    // The DB lives at <projectRoot>/.cctx/sessions.db — so projectRoot = parent of .cctx dir.
    const cwd = dirname(dirname(dbPath)); // sessions.db → .cctx → projectRoot
    getDb(cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate all existing project databases found on the machine.
 * Safe to call from postinstall — never throws, logs to stderr only.
 */
export async function migrateAll(): Promise<void> {
  try {
    const dbs = findAllProjectDbs();
    if (dbs.length === 0) return;

    let migrated = 0;
    let failed = 0;
    for (const dbPath of dbs) {
      if (!existsSync(dbPath)) continue;
      if (migrateDb(dbPath)) {
        migrated++;
      } else {
        failed++;
      }
    }

    log.info(
      `cctx: migrated ${migrated} project database(s) to latest schema` +
        (failed > 0 ? ` (${failed} skipped — locked or corrupt)` : ""),
    );
  } catch {
    // Silently swallow — postinstall must never fail the npm install
  }
}

/**
 * Migrate just the current working directory's DB.
 * Called from MCP server startup to guarantee the active project is migrated
 * before any tool call, regardless of whether postinstall ran.
 */
export function migrateCurrentProject(cwd: string = process.cwd()): void {
  try {
    getDb(cwd);
  } catch {
    // Silently swallow — MCP server must never crash on migration failure
  }
}
