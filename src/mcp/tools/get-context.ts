import type { ToolDef } from "./index.js";
import { getOrCreateActiveSession } from "../../store/sessions.js";
import { assembleOptimizedContext } from "../../summarizer/assembler.js";
import { loadConfig } from "../../utils/config.js";

export const getOptimizedContext: ToolDef = {
  name: "get_optimized_context",
  description:
    "Return the optimized conversation context for the current session: structured summaries of older turns plus a small window of recent verbatim turns. Use this at the start of a turn instead of relying on the raw conversation history.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "Optional. Defaults to the most recent active session for this project." },
    },
  },
  handler: async (args) => {
    const cfg = loadConfig();
    const sessionId = (args.session_id as string | undefined) ?? getOrCreateActiveSession(cfg.model.active).id;
    const ctx = assembleOptimizedContext(sessionId);
    return {
      session_id: sessionId,
      summarized_turns: ctx.summarizedTurns,
      verbatim_turns: ctx.verbatimTurns,
      context: ctx.text,
    };
  },
};
