import type { ToolDef } from "./index.js";
import { compress } from "../../compressor/dispatcher.js";
import { recordCompression } from "../../store/tool-compressions.js";
import { getOrCreateActiveSession } from "../../store/sessions.js";
import { loadConfig } from "../../utils/config.js";
import type { ToolType } from "../../compressor/types.js";

const ALLOWED_TYPES: ToolType[] = ["read_file", "bash", "grep", "test_runner", "list_dir", "web", "unknown"];

export const compressToolResultTool: ToolDef = {
  name: "compress_tool_result",
  description:
    "Compress the raw output of a tool call to its essential content. Dispatches by tool_type: bash/grep/test_runner/list_dir use deterministic rules (instant), read_file uses the codebase index cache when current, web/large file reads use the local LLM.",
  inputSchema: {
    type: "object",
    properties: {
      tool_type: { type: "string", enum: ALLOWED_TYPES as unknown as string[] },
      raw_output: { type: "string" },
      file_path: { type: "string", description: "For tool_type=read_file: the project-relative path." },
      exit_code: { type: "number", description: "For tool_type=bash or test_runner." },
      command: { type: "string", description: "For tool_type=bash: the command that produced the output." },
    },
    required: ["tool_type", "raw_output"],
  },
  handler: async (args) => {
    const toolType = String(args.tool_type ?? "unknown") as ToolType;
    if (!ALLOWED_TYPES.includes(toolType)) {
      throw new Error(`Invalid tool_type: ${toolType}`);
    }

    // Validate file_path: must be relative, no parent traversal, reasonable length.
    let filePath: string | undefined;
    if (args.file_path !== undefined) {
      if (typeof args.file_path !== "string") throw new Error("file_path must be a string");
      if (args.file_path.length > 500) throw new Error("file_path exceeds max length (500)");
      if (args.file_path.includes("..") || args.file_path.startsWith("/")) {
        throw new Error("file_path must be a relative path with no parent directory references");
      }
      filePath = args.file_path;
    }

    // Validate exit_code: integer 0–255.
    let exitCode: number | undefined;
    if (args.exit_code !== undefined) {
      if (typeof args.exit_code !== "number" || !Number.isInteger(args.exit_code)) {
        throw new Error("exit_code must be an integer");
      }
      if (args.exit_code < -1 || args.exit_code > 255) {
        throw new Error("exit_code must be between -1 and 255");
      }
      exitCode = args.exit_code;
    }

    // Validate command: string, max 1000 chars.
    let command: string | undefined;
    if (args.command !== undefined) {
      if (typeof args.command !== "string") throw new Error("command must be a string");
      if (args.command.length > 1000) throw new Error("command exceeds max length (1000)");
      command = args.command;
    }

    const result = await compress({
      toolType,
      rawOutput: String(args.raw_output ?? ""),
      filePath,
      exitCode,
      command,
    });
    const cfg = loadConfig();
    const session = getOrCreateActiveSession(cfg.model.active);
    recordCompression({
      sessionId: session.id,
      toolType,
      rawTokensEst: result.rawTokens,
      compressedTokensEst: result.compressedTokens,
      strategy: result.strategy,
    });
    return {
      compressed: result.compressed,
      strategy: result.strategy,
      raw_tokens: result.rawTokens,
      compressed_tokens: result.compressedTokens,
      saved_tokens: Math.max(0, result.rawTokens - result.compressedTokens),
    };
  },
};
