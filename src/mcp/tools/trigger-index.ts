import type { ToolDef } from "./index.js";
import { runIndex } from "../../indexer/runner.js";
import { log } from "../../utils/logger.js";

let inFlight: Promise<unknown> | null = null;

export const triggerIndexTool: ToolDef = {
  name: "trigger_index",
  description: "Kick off a background re-index of the project. Returns immediately if an index is already running.",
  inputSchema: {
    type: "object",
    properties: {
      force: { type: "boolean", description: "Re-index all files even if unchanged." },
    },
  },
  handler: async (args) => {
    if (inFlight) {
      return { started: false, reason: "Index already running" };
    }
    const force = Boolean(args.force);
    inFlight = runIndex({ force })
      .then((r) => {
        log.info(`Background index completed: ${r.filesIndexed} indexed, ${r.filesSkipped} skipped`);
        return r;
      })
      .catch((e) => log.warn("Background index failed", e))
      .finally(() => {
        inFlight = null;
      });
    return { started: true };
  },
};
