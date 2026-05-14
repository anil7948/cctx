import ora from "ora";
import { ensureDaemon } from "../ollama/manager.js";
import { loadConfig, saveGlobalConfig } from "../utils/config.js";
import { clientFromConfig } from "../ollama/client.js";
import { fmt, formatBytes } from "./format.js";

export async function modelList(): Promise<void> {
  const cfg = loadConfig();
  await ensureDaemon();
  const client = clientFromConfig(cfg.ollama.port);
  const models = await client.listModels();
  if (models.length === 0) {
    console.log(fmt.warn("No models installed. Run `cctx model pull <name>`."));
    return;
  }
  for (const m of models) {
    const active = m === cfg.model.active || m.startsWith(`${cfg.model.active}:`);
    console.log(`${active ? fmt.ok("active ") : "       "} ${m}`);
  }
}

export async function modelSet(name: string): Promise<void> {
  const cfg = loadConfig();
  await ensureDaemon();
  const client = clientFromConfig(cfg.ollama.port);
  const models = await client.listModels();
  if (!models.some((m) => m === name || m.startsWith(`${name}:`))) {
    console.log(fmt.err(`Model '${name}' is not installed. Run \`cctx model pull ${name}\` first.`));
    process.exitCode = 1;
    return;
  }
  cfg.model.active = name;
  saveGlobalConfig(cfg);
  console.log(fmt.ok(`Active model set to ${name}`));
}

export async function modelPull(name: string): Promise<void> {
  const cfg = loadConfig();
  await ensureDaemon();
  const client = clientFromConfig(cfg.ollama.port);
  const spinner = ora(`Pulling ${name}`).start();
  try {
    await client.pull(name, (status, completed, total) => {
      if (total > 0) {
        spinner.text = `${status} (${formatBytes(completed)} / ${formatBytes(total)})`;
      } else if (status) {
        spinner.text = status;
      }
    });
    spinner.succeed(`${name} ready`);
  } catch (e) {
    spinner.fail(`Pull failed: ${(e as Error).message}`);
    process.exitCode = 1;
  }
  cfg.model.installed = await client.listModels();
  saveGlobalConfig(cfg);
}

export async function modelRemove(name: string): Promise<void> {
  // Ollama exposes model deletion via DELETE /api/delete; we wrap that here
  // because the manager API doesn't justify a dedicated client method.
  const cfg = loadConfig();
  await ensureDaemon();
  const { request } = await import("undici");
  const res = await request(`http://127.0.0.1:${cfg.ollama.port}/api/delete`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (res.statusCode >= 200 && res.statusCode < 300) {
    console.log(fmt.ok(`Removed ${name}`));
  } else {
    const text = await res.body.text();
    console.log(fmt.err(`Remove failed (HTTP ${res.statusCode}): ${text.slice(0, 200)}`));
    process.exitCode = 1;
  }
}
