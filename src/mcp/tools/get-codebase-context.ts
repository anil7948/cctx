import type { ToolDef } from "./index.js";
import { buildProjectMap } from "../../indexer/map-builder.js";

export const getCodebaseContextTool: ToolDef = {
  name: "get_codebase_context",
  description:
    "Return a pre-built semantic map of the project: every indexed file with its purpose, exports, and notes. Use this once at the start of a session instead of reading dozens of files to learn the project structure.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    return buildProjectMap();
  },
};
