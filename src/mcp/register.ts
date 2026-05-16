import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { paths } from "../utils/paths.js";
import { log } from "../utils/logger.js";

interface ClaudeCodeMcpConfig {
  mcpServers?: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
}

// Separate read helpers: one that is safe for read-only callers (isMcpRegistered,
// called inside doctor.ts with no error handling), one that throws on corruption
// for write-path callers where a silent overwrite would destroy user config.

function readClaudeConfigSafe(): ClaudeCodeMcpConfig {
  if (!existsSync(paths.claudeCodeConfig)) return {};
  try {
    const raw = JSON.parse(readFileSync(paths.claudeCodeConfig, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return raw as ClaudeCodeMcpConfig;
  } catch {
    return {};
  }
}

function readClaudeConfigStrict(): ClaudeCodeMcpConfig {
  if (!existsSync(paths.claudeCodeConfig)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(paths.claudeCodeConfig, "utf8"));
  } catch (e) {
    // File exists but is not valid JSON — refuse to overwrite silently.
    throw new Error(
      `${paths.claudeCodeConfig} contains invalid JSON: ${(e as Error).message}. ` +
        "Fix or delete the file before running cctx setup.",
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      `${paths.claudeCodeConfig} has unexpected format (expected a JSON object). ` +
        "Fix or delete the file before running cctx setup.",
    );
  }
  return raw as ClaudeCodeMcpConfig;
}

function writeClaudeConfig(cfg: ClaudeCodeMcpConfig): void {
  mkdirSync(dirname(paths.claudeCodeConfig), { recursive: true });
  writeFileSync(paths.claudeCodeConfig, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function registerMcpServer(command: string): void {
  const cfg = readClaudeConfigStrict();
  cfg.mcpServers = cfg.mcpServers ?? {};
  // Guard: skip write if the entry already matches to avoid dirty writes.
  const existing = cfg.mcpServers.cctx;
  if (existing && existing.command === command && JSON.stringify(existing.args) === JSON.stringify(["mcp"])) {
    log.info("cctx MCP server already registered with matching config — skipping write");
    return;
  }
  cfg.mcpServers.cctx = { command, args: ["mcp"], env: {} };
  writeClaudeConfig(cfg);
}

export function unregisterMcpServer(): void {
  // Use safe reader: if the config is corrupt at uninstall time there's nothing
  // meaningful to remove, so return quietly rather than aborting the uninstall.
  const cfg = readClaudeConfigSafe();
  if (!cfg.mcpServers?.cctx) return;
  delete cfg.mcpServers.cctx;
  writeClaudeConfig(cfg);
}

export function isMcpRegistered(): boolean {
  // Uses safe reader — never throws, so callers in doctor.ts don't need try/catch.
  const cfg = readClaudeConfigSafe();
  return Boolean(cfg.mcpServers?.cctx);
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
