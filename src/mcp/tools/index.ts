import { getOptimizedContext } from "./get-context.js";
import { recordTurnTool } from "./record-turn.js";
import { flushSessionTool } from "./flush-session.js";
import { getSessionStatsTool } from "./get-stats.js";
import { newSessionTool } from "./new-session.js";
import { getCodebaseContextTool } from "./get-codebase-context.js";
import { getFileSummaryTool } from "./get-file-summary.js";
import { triggerIndexTool } from "./trigger-index.js";
import { getIndexStatusTool } from "./get-index-status.js";
import { compressToolResultTool } from "./compress-tool-result.js";
import { getCompressionStatsTool } from "./get-compression-stats.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<string | Record<string, unknown>>;
}

export const tools: ToolDef[] = [
  getOptimizedContext,
  recordTurnTool,
  flushSessionTool,
  getSessionStatsTool,
  newSessionTool,
  getCodebaseContextTool,
  getFileSummaryTool,
  triggerIndexTool,
  getIndexStatusTool,
  compressToolResultTool,
  getCompressionStatsTool,
];

const byName = new Map(tools.map((t) => [t.name, t]));

export async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string | Record<string, unknown>> {
  const tool = byName.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.handler(args);
}
