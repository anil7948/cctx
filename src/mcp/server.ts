import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools, dispatchTool } from "./tools/index.js";
import { log } from "../utils/logger.js";
import { migrateCurrentProject } from "../cli/migrate.js";

export async function runMcpServer(): Promise<void> {
  // Ensure the current project's DB is migrated to the latest schema before
  // handling any tool calls. This is the safety net for cases where postinstall
  // was skipped (manual binary copy, CI environments, etc.).
  migrateCurrentProject(process.cwd());
  const server = new Server(
    { name: "cctx", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};
    try {
      const result = await dispatchTool(name, args);
      return {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      const msg = (e as Error).message;
      log.error(`Tool ${name} failed`, e);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${msg}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("cctx MCP server ready on stdio");
}
