import { loadConfig } from "../utils/config.js";
import type { CompressionInput } from "./types.js";

export function compressGrep(input: CompressionInput): { text: string; strategy: string } {
  const cfg = loadConfig();
  const max = cfg.toolCompression.grepMaxMatches;
  const lines = input.rawOutput.split("\n").filter((l) => l.length > 0);

  if (lines.length <= max) {
    return { text: input.rawOutput, strategy: "grep:passthrough" };
  }

  const visibleCount = Math.floor(max * 0.6);
  const kept = lines.slice(0, visibleCount);
  const remaining = lines.length - visibleCount;
  kept.push(`[${remaining} more matches — refine your search]`);
  return { text: kept.join("\n"), strategy: "grep:truncate" };
}
