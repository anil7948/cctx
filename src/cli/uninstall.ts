import { existsSync, rmSync } from "node:fs";
import { stopDaemon } from "../ollama/manager.js";
import { unregisterMcpServer } from "../mcp/register.js";
import { unregisterGlobalInstructions } from "./global-instructions.js";
import { unregisterStopHook, unregisterCompressHook } from "./hooks.js";
import { paths } from "../utils/paths.js";
import { fmt } from "./format.js";

export async function uninstall(opts: { keepModels?: boolean }): Promise<void> {
  await stopDaemon();
  unregisterMcpServer();
  unregisterGlobalInstructions();
  unregisterStopHook();
  unregisterCompressHook();

  const toRemove: string[] = [
    paths.bin,
    paths.globalConfig,
    paths.daemonPidFile,
    paths.daemonLog,
    paths.cctxInstructions,
  ];
  if (!opts.keepModels) toRemove.push(paths.ollamaModels);

  for (const p of toRemove) {
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      console.log(fmt.ok(`Removed ${p}`));
    }
  }
  console.log(fmt.ok("cctx uninstalled. Run `npm uninstall -g cctx` to remove the CLI itself."));
}
