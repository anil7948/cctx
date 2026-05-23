#!/usr/bin/env node
/**
 * npm postinstall script — runs automatically after `npm install -g cctx-optimizer`.
 *
 * Does two things silently in the background:
 *   1. Migrates all existing cctx project databases to the current schema version.
 *   2. Re-registers the MCP server in ~/.claude.json so upgrades are zero-touch
 *      for users who previously ran `cctx setup`.  This is needed because:
 *        - Claude Code 2.x moved MCP config from claude_code_config.json → ~/.claude.json
 *        - The binary path may change between npm versions (e.g. new global prefix)
 *
 * Design: never throws, never blocks npm install, exits 0 always.
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateAll } from "./migrate.js";
import { registerMcpServer } from "../mcp/register.js";
import { paths } from "../utils/paths.js";
import { log } from "../utils/logger.js";

/** Resolve the installed cctx binary path. */
function cctxBinaryPath(): string {
  // Try `which cctx` first — works when npm bin is on PATH (typical global install)
  try {
    const p = execSync("which cctx", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    if (p) return p;
  } catch { /* not on PATH yet — fall through */ }

  // Fallback: derive from npm global prefix
  try {
    const prefix = execSync("npm prefix -g", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    const candidate = join(prefix, "bin", "cctx");
    if (existsSync(candidate)) return candidate;
  } catch { /* ignore */ }

  // Last resort: use the dist/cli/index.js sibling of this script
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDir, "index.js");
}

async function postinstall(): Promise<void> {
  // Step 1: DB migration (always safe to run — idempotent)
  await migrateAll();

  // Step 2: Re-register MCP server if Claude Code is installed.
  // This keeps the registration current across npm upgrades — zero user action needed.
  try {
    const binary = cctxBinaryPath();

    if (existsSync(paths.claudeJson)) {
      // Claude Code 2.x: ~/.claude.json exists — always refresh registration
      registerMcpServer(binary);
      log.info(`cctx: MCP server registration refreshed → ${binary}`);
    } else if (existsSync(paths.claudeCodeConfig)) {
      // Claude Code 1.x config exists: only migrate if user already had cctx registered
      try {
        const legacy = JSON.parse(readFileSync(paths.claudeCodeConfig, "utf8"));
        if (legacy?.mcpServers?.cctx) {
          registerMcpServer(binary);
          log.info(`cctx: migrated MCP registration from claude_code_config.json → ~/.claude.json`);
        }
      } catch { /* legacy config unreadable — skip */ }
    }
    // If neither file exists: Claude Code not installed, nothing to register
  } catch (e) {
    log.warn(`cctx: postinstall MCP re-registration skipped: ${(e as Error).message}`);
  }
}

postinstall()
  .then(() => process.exit(0))
  .catch(() => process.exit(0)); // never let postinstall fail npm install
