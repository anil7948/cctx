import type { CompressionInput } from "./types.js";

const DIR_HINT_RE = /\/$|^d[rwx-]{9}/;

export function compressListDir(input: CompressionInput): { text: string; strategy: string } {
  const entries = input.rawOutput.split("\n").filter((l) => l.length > 0);
  if (entries.length <= 30) {
    return { text: input.rawOutput, strategy: "ls:passthrough" };
  }
  const dirs: string[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    if (DIR_HINT_RE.test(entry)) dirs.push(entry);
    else files.push(entry);
  }
  const out: string[] = [];
  if (dirs.length) out.push(...dirs);
  if (files.length > 20) {
    out.push(...files.slice(0, 20));
    out.push(`[${files.length - 20} more files]`);
  } else {
    out.push(...files);
  }
  return { text: out.join("\n"), strategy: "ls:group" };
}
