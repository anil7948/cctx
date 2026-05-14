import type { ToolDef } from "./index.js";
import { createSession } from "../../store/sessions.js";
import { loadConfig } from "../../utils/config.js";

export const newSessionTool: ToolDef = {
  name: "new_session",
  description: "Explicitly start a new context boundary. Use this when switching tasks within the same Claude Code window so summaries don't bleed across unrelated work.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    const cfg = loadConfig();
    const session = createSession(cfg.model.active);
    return { session_id: session.id, created_at: session.created_at };
  },
};
