import type { ToolDef } from "./index.js";
import { getFileIndex } from "../../store/file-index.js";

export const getFileSummaryTool: ToolDef = {
  name: "get_file_summary",
  description: "Return the indexed semantic summary for a single file (relative path from project root). Returns null if the file is not indexed.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Relative path from the project root." },
    },
    required: ["file_path"],
  },
  handler: async (args) => {
    if (typeof args.file_path !== "string") throw new Error("file_path must be a string");
    const filePath = args.file_path.trim();
    if (!filePath) throw new Error("file_path is required");
    if (filePath.length > 500) throw new Error("file_path exceeds max length (500)");
    if (filePath.includes("..") || filePath.startsWith("/")) {
      throw new Error("file_path must be a relative path with no parent directory references");
    }
    const row = getFileIndex(filePath);
    if (!row) return { file_path: filePath, indexed: false };
    return {
      file_path: filePath,
      indexed: true,
      indexed_at: row.indexed_at,
      file_mtime: row.file_mtime,
      summary: row.parsed,
    };
  },
};
