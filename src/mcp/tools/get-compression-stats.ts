import type { ToolDef } from "./index.js";
import { compressionStatsForSession } from "../../store/tool-compressions.js";
import { getOrCreateActiveSession } from "../../store/sessions.js";
import { loadConfig } from "../../utils/config.js";

export const getCompressionStatsTool: ToolDef = {
  name: "get_compression_stats",
  description: "Per-tool-type token savings for the current session (Layer 2).",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
    },
  },
  handler: async (args) => {
    const cfg = loadConfig();
    const sessionId = (args.session_id as string | undefined) ?? getOrCreateActiveSession(cfg.model.active).id;
    const stats = compressionStatsForSession(sessionId);
    return { session_id: sessionId, by_tool: stats.byTool, total: stats.total };
  },
};
