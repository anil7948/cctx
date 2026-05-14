import type { ToolDef } from "./index.js";
import { getOrCreateActiveSession } from "../../store/sessions.js";
import { listTurns } from "../../store/turns.js";
import { listSummaries } from "../../store/summaries.js";
import { compressionStatsForSession } from "../../store/tool-compressions.js";
import { loadConfig } from "../../utils/config.js";

export const getSessionStatsTool: ToolDef = {
  name: "get_session_stats",
  description: "Return a breakdown of token savings for the current session across all three layers (codebase index, tool compression, turn summarization).",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
    },
  },
  handler: async (args) => {
    const cfg = loadConfig();
    const sessionId = (args.session_id as string | undefined) ?? getOrCreateActiveSession(cfg.model.active).id;
    const turns = listTurns(sessionId);
    const summaries = listSummaries(sessionId);
    const tool = compressionStatsForSession(sessionId);

    const rawTurns = turns.reduce((a, t) => a + t.raw_tokens_est, 0);
    const compressedTurns = summaries.reduce((a, s) => a + s.compressed_tokens_est, 0);
    const layer3Saved = Math.max(0, rawTurns - compressedTurns);

    return {
      session_id: sessionId,
      turns: turns.length,
      summarized_turns: summaries.length,
      layer2_tool_compression: tool,
      layer3_turn_summarization: {
        raw_tokens: rawTurns,
        compressed_tokens: compressedTurns,
        saved_tokens: layer3Saved,
      },
    };
  },
};
