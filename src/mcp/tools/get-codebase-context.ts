import type { ToolDef } from "./index.js";
import { buildProjectMapPage } from "../../indexer/map-builder.js";

export const getCodebaseContextTool: ToolDef = {
  name: "get_codebase_context",
  description:
    "Return a pre-built semantic map of the project: every indexed file with its purpose, exports, and notes. " +
    "Use this once at the start of a session instead of reading dozens of files to learn the project structure. " +
    "For large projects the map is paginated — if a page number is returned, call again with that page to get the next section.",
  inputSchema: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description: "Page number to retrieve (1-based). Omit or pass 1 for the first page.",
      },
    },
  },
  handler: async (args: { page?: number }) => {
    const page = typeof args.page === "number" ? args.page : 1;
    const result = buildProjectMapPage(process.cwd(), page);
    return result.text;
  },
};
