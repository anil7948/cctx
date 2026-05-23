import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { paths } from "../utils/paths.js";
import { log } from "../utils/logger.js";

/**
 * Claude Code 2.x stores user-scope MCP servers in ~/.claude.json under the
 * top-level "mcpServers" key.  Each entry has { type, command, args, env }.
 *
 * Claude Code 1.x used ~/.claude/claude_code_config.json.  We keep cleanup
 * logic for that file so upgrades from 1.x don't leave a ghost entry.
 */

interface ClaudeJsonMcpEntry {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

// Read ~/.claude.json safely — returns {} on missing / corrupt file.
function readClaudeJsonSafe(): Record<string, unknown> {
  if (!existsSync(paths.claudeJson)) return {};
  try {
    const raw = JSON.parse(readFileSync(paths.claudeJson, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return raw as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Read ~/.claude.json strictly — throws on corrupt JSON so write-path callers
// don't silently overwrite a file the user edited by hand.
function readClaudeJsonStrict(): Record<string, unknown> {
  if (!existsSync(paths.claudeJson)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(paths.claudeJson, "utf8"));
  } catch (e) {
    throw new Error(
      `${paths.claudeJson} contains invalid JSON: ${(e as Error).message}. ` +
      "Please fix it manually before registering cctx.",
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      `${paths.claudeJson} has unexpected format (expected a JSON object). ` +
      "Please fix it manually before registering cctx.",
    );
  }
  return raw as Record<string, unknown>;
}

function writeClaudeJson(doc: Record<string, unknown>): void {
  writeFileSync(paths.claudeJson, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

// Strip the legacy cctx entry from ~/.claude/claude_code_config.json (1.x).
// Safe no-op if the file doesn't exist or has no cctx entry.
function cleanupLegacyConfig(): void {
  try {
    if (!existsSync(paths.claudeCodeConfig)) return;
    const raw = JSON.parse(readFileSync(paths.claudeCodeConfig, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
    const cfg = raw as { mcpServers?: Record<string, unknown> };
    if (!cfg.mcpServers?.cctx) return;
    delete cfg.mcpServers.cctx;
    writeFileSync(paths.claudeCodeConfig, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    log.info("cctx: removed legacy MCP entry from claude_code_config.json");
  } catch {
    // best-effort — never block registration
  }
}

export function registerMcpServer(command: string): void {
  const doc = readClaudeJsonStrict();

  // Ensure top-level mcpServers object exists
  if (typeof doc.mcpServers !== "object" || doc.mcpServers === null || Array.isArray(doc.mcpServers)) {
    doc.mcpServers = {};
  }
  const mcpServers = doc.mcpServers as Record<string, ClaudeJsonMcpEntry>;

  // Skip write if already identical — avoids unnecessary file churn on postinstall
  const existing = mcpServers.cctx;
  if (existing && existing.command === command &&
      JSON.stringify(existing.args) === JSON.stringify(["mcp"])) {
    cleanupLegacyConfig();
    return;
  }

  mcpServers.cctx = { type: "stdio", command, args: ["mcp"], env: {} };
  doc.mcpServers = mcpServers;
  writeClaudeJson(doc);

  // Also clean up any stale 1.x entry so "claude mcp list" doesn't show duplicates
  cleanupLegacyConfig();

  log.info(`cctx: registered MCP server in ${paths.claudeJson}`);
}

export function unregisterMcpServer(): void {
  const doc = readClaudeJsonSafe();
  const mcpServers = doc.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers?.cctx) return;
  delete mcpServers.cctx;
  doc.mcpServers = mcpServers;
  writeClaudeJson(doc);
  cleanupLegacyConfig();
}

export function isMcpRegistered(): boolean {
  const doc = readClaudeJsonSafe();
  const mcpServers = doc.mcpServers as Record<string, unknown> | undefined;
  return Boolean(mcpServers?.cctx);
}

export function installSlashCommand(): void {
  const dir = paths.claudeCommandsDir;
  mkdirSync(dir, { recursive: true });
  const body = `---
description: Force local-LLM compaction of the current Claude Code session via cctx.
---

Call the \`flush_session\` MCP tool on the \`cctx\` server, then call \`get_optimized_context\` and read the returned context into your working memory.
`;
  writeFileSync(`${dir}/compact-local.md`, body, "utf8");
}
