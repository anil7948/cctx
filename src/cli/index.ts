#!/usr/bin/env node
import { Command } from "commander";
import { runSetup } from "./setup.js";
import { daemonStart, daemonStop, daemonStatusCmd, daemonRestart } from "./daemon.js";
import { modelList, modelSet, modelPull, modelRemove } from "./model.js";
import { sessionList, sessionStats, sessionFlush, sessionExport, hookStop, compressHook } from "./session.js";
import { indexRun, indexStatus, indexWatch } from "./index-cmd.js";
import { injectClaudeMd } from "./inject.js";
import { registerGlobalInstructions } from "./global-instructions.js";
import { doctor } from "./doctor.js";
import { configShow, configGet, configSet } from "./config.js";
import { uninstall } from "./uninstall.js";
import { runMcpServer } from "../mcp/server.js";
import { fmt } from "./format.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
const { version } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"));

const program = new Command();
program
  .name("cctx")
  .description("Claude Context Optimizer — local-LLM-backed token reduction for Claude Code")
  .version(version);

program
  .command("setup")
  .description("First-time setup: install Ollama, pull model, register MCP, run initial codebase index")
  .option("--model <name>", "Model to install (default phi3.5)")
  .option("--yes", "Non-interactive mode")
  .action(async (opts) => {
    await runSetup(opts);
  });

const daemonCmd = program.command("daemon").description("Manage the background Ollama daemon");
daemonCmd.command("start").action(daemonStart);
daemonCmd.command("stop").action(daemonStop);
daemonCmd.command("status").action(daemonStatusCmd);
daemonCmd.command("restart").action(daemonRestart);

const modelCmd = program.command("model").description("Manage local models");
modelCmd.command("list").action(modelList);
modelCmd.command("set <name>").action(modelSet);
modelCmd.command("pull <name>").action(modelPull);
modelCmd.command("remove <name>").action(modelRemove);

const indexCmd = program.command("index").description("Manage the codebase semantic index (Layer 1)");
indexCmd
  .command("run")
  .description("Index changed files in the current project")
  .option("--path <dir>", "Project path", process.cwd())
  .option("--force", "Re-index all files even if unchanged")
  .action(async (opts) => {
    await indexRun(opts);
  });
indexCmd.command("status").action(indexStatus);
indexCmd
  .command("watch")
  .description("Watch for file changes and re-index incrementally")
  .option("--path <dir>", "Project path", process.cwd())
  .action(async (opts) => {
    await indexWatch(opts);
  });

const sessionCmd = program.command("session").description("Inspect and manage Claude Code sessions");
sessionCmd.command("list").action(sessionList);
sessionCmd
  .command("stats")
  .option("--session-id <id>")
  .option("--watch", "Refresh every 3 seconds (Ctrl+C to exit)")
  .action((opts) => sessionStats(opts.sessionId, { watch: opts.watch }));
sessionCmd
  .command("flush")
  .option("--session-id <id>")
  .action(async (opts) => {
    await sessionFlush(opts.sessionId);
  });
sessionCmd
  .command("hook-stop")
  .description("Called by Claude Code Stop hook — reads stdin JSON, records last turn to DB")
  .action(async () => {
    await hookStop();
  });

sessionCmd
  .command("compress-hook")
  .description("Called by Claude Code PostToolUse hook — reads stdin JSON, compresses large tool output, writes updatedToolOutput JSON to stdout")
  .action(async () => {
    await compressHook();
  });

sessionCmd
  .command("export")
  .option("--session-id <id>")
  .option("--format <fmt>", "json or md", "md")
  .option("--out <file>", "Output file (default stdout)")
  .action((opts) =>
    sessionExport({
      sessionId: opts.sessionId,
      format: opts.format === "json" ? "json" : "md",
      out: opts.out,
    }),
  );

program
  .command("inject")
  .description("Write codebase map into CLAUDE.md")
  .option("--file <file>", "Target file", "CLAUDE.md")
  .action(injectClaudeMd);

program
  .command("register-instructions")
  .description("Write cctx tool instructions to ~/.cctx/instructions.md and register via ~/.claude/CLAUDE.md")
  .action(() => {
    registerGlobalInstructions();
  });

program.command("doctor").description("Run health checks").action(doctor);

const configCmd = program.command("config").description("Manage configuration");
configCmd.command("show").action(configShow);
configCmd.command("get <key>").action(configGet);
configCmd.command("set <key> <value>").action(configSet);

program
  .command("mcp")
  .description("Start as MCP server (called internally by Claude Code — not for direct invocation)")
  .action(async () => {
    await runMcpServer();
  });

program
  .command("uninstall")
  .description("Remove cctx-installed components")
  .option("--keep-models", "Preserve downloaded models")
  .action(async (opts) => {
    await uninstall(opts);
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(fmt.err((e as Error).message));
  process.exit(1);
});
