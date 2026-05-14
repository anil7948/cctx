import type { ToolDef } from "./index.js";
import { lastIndexRun, listFileIndex } from "../../store/file-index.js";
import { walkProject } from "../../indexer/walker.js";
import { projectRoot } from "../../utils/paths.js";

export const getIndexStatusTool: ToolDef = {
  name: "get_index_status",
  description: "Report the last index run, total indexed files, and how many files have changed since the last run.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    const last = lastIndexRun();
    const indexed = listFileIndex();
    const indexedByPath = new Map(indexed.map((f) => [f.file_path, f]));
    const present = walkProject(projectRoot());
    let pending = 0;
    for (const f of present) {
      const cached = indexedByPath.get(f.relPath);
      if (!cached || cached.file_mtime !== f.mtime || cached.file_size !== f.size) pending++;
    }
    return {
      last_run: last,
      total_indexed: indexed.length,
      files_on_disk: present.length,
      pending_changes: pending,
    };
  },
};
