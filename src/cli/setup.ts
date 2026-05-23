import ora from "ora";
import { existsSync } from "node:fs";
import { downloadOllama, isOllamaInstalled } from "../ollama/installer.js";
import { startDaemon, daemonStatus } from "../ollama/manager.js";
import { clientFromConfig } from "../ollama/client.js";
import { loadConfig, saveGlobalConfig } from "../utils/config.js";
import { registerMcpServer, installSlashCommand } from "../mcp/register.js";
import { registerGlobalInstructions } from "./global-instructions.js";
import { registerStopHook, registerCompressHook } from "./hooks.js";
import { runIndex } from "../indexer/runner.js";
import { summarizeTurn } from "../summarizer/engine.js";
import { fmt, formatBytes } from "./format.js";
import { paths } from "../utils/paths.js";

function which(): string {
  // Find the absolute path to the cctx binary that should be invoked by Claude
  // Code's MCP launcher. This is whichever copy was used to run `cctx setup`.
  return process.argv[1] ?? "cctx";
}

export async function runSetup(opts: { model?: string; yes?: boolean }): Promise<void> {
  const cfg = loadConfig();
  if (opts.model) cfg.model.active = opts.model;
  console.log(fmt.bold(`Setting up cctx (model: ${cfg.model.active})`));

  // Step 1: Ollama binary
  if (cfg.ollama.managedByUser) {
    console.log(fmt.info(`Ollama is user-managed — skipping install (port ${cfg.ollama.port})`));
  } else if (!isOllamaInstalled()) {
    const spinner = ora("Downloading Ollama (https://ollama.com/download)").start();
    try {
      await downloadOllama((downloaded, total) => {
        if (total > 0) {
          spinner.text = `Downloading Ollama (${formatBytes(downloaded)} / ${formatBytes(total)})`;
        } else {
          spinner.text = `Downloading Ollama (${formatBytes(downloaded)})`;
        }
      });
      spinner.succeed(`Ollama installed at ${paths.ollamaBinary}`);
    } catch (e) {
      spinner.fail(`Ollama download failed. Check internet connectivity.`);
      console.error(`Details: ${(e as Error).message}`);
      throw e;
    }
  } else {
    console.log(fmt.ok(`Ollama already installed at ${paths.ollamaBinary}`));
  }

  // Step 2: Start daemon
  const startSpinner = ora("Starting Ollama daemon on port 11435").start();
  try {
    await startDaemon();
    const status = await daemonStatus();
    if (!status.reachable) {
      startSpinner.fail("Daemon did not become reachable within 30 seconds");
      console.error("Check ~/.cctx/daemon.log for errors (port conflict is common).");
      throw new Error("Ollama daemon failed to start");
    }
    startSpinner.succeed(`Daemon ready on port ${status.port}`);
  } catch (e) {
    startSpinner.fail((e as Error).message);
    throw e;
  }

  // Step 3: Pull model
  const client = clientFromConfig(cfg.ollama.port);
  const installed = await client.listModels();
  if (!installed.some((m) => m === cfg.model.active || m.startsWith(`${cfg.model.active}:`))) {
    const pullSpinner = ora(`Pulling model ${cfg.model.active}`).start();
    try {
      await client.pull(cfg.model.active, (statusMsg, completed, total) => {
        if (total > 0) {
          pullSpinner.text = `${statusMsg} (${formatBytes(completed)} / ${formatBytes(total)})`;
        } else if (statusMsg) {
          pullSpinner.text = statusMsg;
        }
      });
      pullSpinner.succeed(`${cfg.model.active} ready`);
    } catch (e) {
      pullSpinner.fail(`Pull failed: ${(e as Error).message}`);
      throw e;
    }
  } else {
    console.log(fmt.ok(`Model ${cfg.model.active} already installed`));
  }
  cfg.model.installed = await client.listModels();

  // Step 4: Register MCP
  registerMcpServer(which());
  installSlashCommand();
  cfg.claudeCode.mcpRegistered = true;
  cfg.claudeCode.slashCommandInstalled = true;
  console.log(fmt.ok(`Registered MCP server in Claude Code config (${paths.claudeJson})`));

  saveGlobalConfig(cfg);

  // Step 5: Register hooks — Stop (session recording) and PostToolUse (compression).
  // Failure here is non-fatal: warn and continue rather than abort.
  try {
    registerStopHook(which());
    console.log(fmt.ok(`Registered Stop hook in ${paths.claudeSettings}`));
  } catch (e) {
    console.log(fmt.warn(`Stop hook registration failed: ${(e as Error).message} — run cctx setup to retry`));
  }
  try {
    registerCompressHook(which());
    console.log(fmt.ok(`Registered PostToolUse compress hook in ${paths.claudeSettings}`));
  } catch (e) {
    console.log(fmt.warn(`PostToolUse hook registration failed: ${(e as Error).message} — run cctx setup to retry`));
  }

  // Step 6: Register global instructions
  registerGlobalInstructions();

  // Step 7: First index
  const indexSpinner = ora("Indexing current project").start();
  let indexedCount = 0;
  try {
    const result = await runIndex({
      onFile: (path, action, progress) => {
        if (action === "indexed") {
          indexSpinner.text = `Indexing (${progress.done}/${progress.total}): ${path}`;
        }
      },
    });
    indexedCount = result.filesIndexed;
    indexSpinner.succeed(
      `Indexed ${result.filesIndexed} files (${result.filesSkipped} skipped) in ${(result.durationMs / 1000).toFixed(1)}s`,
    );
    if (result.failures.length > 0) {
      console.log(fmt.warn(`${result.failures.length} files failed to index — run \`cctx index run\` to retry`));
    }
  } catch (e) {
    indexSpinner.warn(`Initial index incomplete: ${(e as Error).message}`);
  }

  // Step 8: Summarizer smoke test
  const testSpinner = ora("Verifying summarizer").start();
  try {
    const start = Date.now();
    await summarizeTurn(
      "What does the file src/cli.ts do?",
      "It defines the entry point of the CLI and routes subcommands to handlers.",
    );
    testSpinner.succeed(`Summarizer test passed (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  } catch (e) {
    testSpinner.warn(`Summarizer test failed: ${(e as Error).message}`);
  }

  const bar = "─".repeat(50);
  console.log("");
  console.log(bar);
  console.log(fmt.bold("  cctx is ready"));
  console.log(bar);
  console.log(`  Model:        ${cfg.model.active}`);
  console.log(`  Daemon port:  ${cfg.ollama.port}`);
  if (indexedCount > 0) console.log(`  Index:        ${indexedCount} files indexed`);
  console.log("");
  console.log("  Next steps:");
  console.log("  1. Restart Claude Code (close and reopen)");
  console.log("  2. Start coding — cctx runs automatically");
  console.log(`  3. Run ${fmt.bold("cctx session stats")} after your first session`);
  console.log(bar);
  if (!existsSync(paths.claudeJson)) {
    console.log(fmt.warn("Claude Code does not appear to be installed — MCP registration written but inactive."));
  }
}
