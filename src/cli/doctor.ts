import { existsSync } from "node:fs";
import { daemonStatus } from "../ollama/manager.js";
import { clientFromConfig } from "../ollama/client.js";
import { loadConfig } from "../utils/config.js";
import { isMcpRegistered } from "../mcp/register.js";
import { isStopHookRegistered } from "./hooks.js";
import { isOllamaInstalled } from "../ollama/installer.js";
import { lastIndexRun, listFileIndex } from "../store/file-index.js";
import { summarizeTurn } from "../summarizer/engine.js";
import { paths } from "../utils/paths.js";
import { fmt } from "./format.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export async function doctor(): Promise<void> {
  const cfg = loadConfig();
  const checks: Check[] = [];

  checks.push({
    name: "Ollama binary",
    ok: cfg.ollama.managedByUser || isOllamaInstalled(),
    detail: cfg.ollama.managedByUser ? "(user-managed)" : paths.ollamaBinary,
    fix: "cctx setup",
  });

  const status = await daemonStatus();
  checks.push({
    name: "Daemon running",
    ok: status.reachable,
    detail: status.reachable ? `pid ${status.pid ?? "?"} port ${status.port}` : "not reachable",
    fix: "cctx daemon start",
  });

  let modelOk = false;
  let modelDetail = "skipped (daemon down)";
  if (status.reachable) {
    try {
      const client = clientFromConfig(cfg.ollama.port);
      const models = await client.listModels();
      modelOk = models.some((m) => m === cfg.model.active || m.startsWith(`${cfg.model.active}:`));
      modelDetail = modelOk ? `${cfg.model.active} installed` : `${cfg.model.active} NOT installed`;
    } catch (e) {
      modelDetail = (e as Error).message;
    }
  }
  checks.push({
    name: "Active model",
    ok: modelOk,
    detail: modelDetail,
    fix: `cctx model pull ${cfg.model.active}`,
  });

  checks.push({
    name: "Claude Code MCP",
    ok: isMcpRegistered(),
    detail: existsSync(paths.claudeCodeConfig)
      ? isMcpRegistered()
        ? "registered"
        : "not registered"
      : "Claude Code config not found",
    fix: "cctx setup",
  });

  checks.push({
    name: "Stop hook",
    ok: isStopHookRegistered(),
    detail: isStopHookRegistered()
      ? `registered (${paths.claudeSettings})`
      : existsSync(paths.claudeSettings)
        ? "not registered"
        : "~/.claude/settings.json not found",
    fix: "cctx setup",
  });

  const indexed = listFileIndex();
  const last = lastIndexRun();
  checks.push({
    name: "Codebase index",
    ok: indexed.length > 0,
    detail: last
      ? `${indexed.length} files, last run ${new Date(last.ran_at).toISOString()}`
      : "never indexed",
    fix: "cctx index run",
  });

  let summarizerOk = false;
  let summarizerDetail = "skipped";
  if (modelOk) {
    try {
      const start = Date.now();
      await summarizeTurn("What is 2 + 2?", "It equals 4.");
      summarizerOk = true;
      summarizerDetail = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    } catch (e) {
      summarizerDetail = (e as Error).message;
    }
  }
  checks.push({
    name: "Summarizer",
    ok: summarizerOk,
    detail: summarizerDetail,
    fix: "cctx daemon restart",
  });

  let allOk = true;
  for (const c of checks) {
    const marker = c.ok ? fmt.ok("") : fmt.err("");
    const fixHint = !c.ok && c.fix ? fmt.dim(`  →  ${c.fix}`) : "";
    console.log(`${marker} ${c.name.padEnd(20)} ${c.detail}${fixHint}`);
    if (!c.ok) allOk = false;
  }
  console.log("");
  if (allOk) {
    console.log(fmt.ok("All checks passed."));
  } else {
    console.log(fmt.warn("Some checks failed — run the suggested commands above, or run `cctx setup` to repair everything."));
    process.exitCode = 1;
  }
}
