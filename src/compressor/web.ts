import { loadConfig } from "../utils/config.js";
import { ensureDaemon } from "../ollama/manager.js";
import { TOOL_COMPRESS_SYSTEM, buildToolCompressPrompt } from "./prompt.js";
import type { CompressionInput } from "./types.js";

export async function compressWeb(input: CompressionInput): Promise<{ text: string; strategy: string }> {
  const cfg = loadConfig();
  if (input.rawOutput.length < 800) {
    return { text: input.rawOutput, strategy: "web:passthrough" };
  }
  const client = await ensureDaemon();
  const result = await client.generate({
    model: cfg.model.active,
    prompt: buildToolCompressPrompt("web", input.rawOutput),
    system: TOOL_COMPRESS_SYSTEM,
    temperature: 0.1,
    numCtx: 8192,
    timeoutMs: 45_000,
  });
  return { text: result.response.trim(), strategy: "web:llm" };
}
