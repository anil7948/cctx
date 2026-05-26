import type { ToolDef } from "./index.js";
import { buildProjectMapPage, buildProjectMapForQuery } from "../../indexer/map-builder.js";

export const getCodebaseContextTool: ToolDef = {
  name: "get_codebase_context",
  description:
    "Return a pre-built semantic map of the project: every indexed file with its purpose, exports, and notes. " +
    "Use this once at the start of a session instead of reading dozens of files to learn the project structure. " +
    "Pass a 'query' to get only the files most relevant to a topic (e.g. 'authentication', 'database migrations'). " +
    "For large projects without a query the map is paginated — call again with page=2, page=3 etc. to get more.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Optional keyword/topic to filter the index. Returns only relevant files ranked by relevance. Omit to get the full paginated index.",
      },
      page: {
        type: "number",
        description: "Page number to retrieve (1-based). Only used when query is not provided. Omit or pass 1 for the first page.",
      },
    },
  },
  handler: async (args: { query?: string; page?: number }) => {
    if (args.query && args.query.trim().length > 0) {
      const result = buildProjectMapForQuery(args.query.trim(), process.cwd());
      return result.text;
    }
    const page = typeof args.page === "number" ? args.page : 1;
    const result = buildProjectMapPage(process.cwd(), page);
    return result.text;
  },
};
