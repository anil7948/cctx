import type { ToolDef } from "./index.js";
import { getOrCreateActiveSession } from "../../store/sessions.js";
import { flushSession } from "../../summarizer/queue.js";
import { loadConfig } from "../../utils/config.js";
import { listPendingTurns } from "../../store/turns.js";

export const flushSessionTool: ToolDef = {
  name: "flush_session",
  description: "Force immediate summarization of all pending raw turns in a session.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
    },
  },
  handler: async (args) => {
    const cfg = loadConfig();
    const sessionId = (args.session_id as string | undefined) ?? getOrCreateActiveSession(cfg.model.active).id;
    const before = listPendingTurns(sessionId).length;
    await flushSession(sessionId);
    const after = listPendingTurns(sessionId).length;
    return { session_id: sessionId, pending_before: before, pending_after: after };
  },
};
