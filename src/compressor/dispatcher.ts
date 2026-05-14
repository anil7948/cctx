import { compressBash } from "./bash.js";
import { compressGrep } from "./grep.js";
import { compressTestRunner } from "./test-runner.js";
import { compressListDir } from "./list-dir.js";
import { compressFileRead } from "./file-read.js";
import { compressWeb } from "./web.js";
import { estimateTokens } from "../utils/tokenizer.js";
import type { CompressionInput, CompressionResult } from "./types.js";

export async function compress(input: CompressionInput, cwd: string = process.cwd()): Promise<CompressionResult> {
  const rawTokens = estimateTokens(input.rawOutput);
  let out: { text: string; strategy: string };

  switch (input.toolType) {
    case "bash":
      out = compressBash(input);
      break;
    case "grep":
      out = compressGrep(input);
      break;
    case "test_runner":
      out = compressTestRunner(input);
      break;
    case "list_dir":
      out = compressListDir(input);
      break;
    case "read_file":
      out = await compressFileRead(input, cwd);
      break;
    case "web":
      out = await compressWeb(input);
      break;
    case "unknown":
    default:
      out = { text: input.rawOutput, strategy: "passthrough" };
  }

  const compressedTokens = estimateTokens(out.text);
  return {
    compressed: out.text,
    strategy: out.strategy,
    rawTokens,
    compressedTokens,
  };
}
