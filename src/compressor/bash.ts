import { loadConfig } from "../utils/config.js";
import type { CompressionInput } from "./types.js";

const NODE_MODULES_FRAME_RE = /(^|\s)(at\s+).*\/node_modules\//;

function head(lines: string[], n: number): string[] {
  return lines.slice(0, n);
}

function tail(lines: string[], n: number): string[] {
  return lines.slice(-n);
}

function filterStackFrames(lines: string[]): string[] {
  return lines.filter((line) => !NODE_MODULES_FRAME_RE.test(line));
}

function compressInstallOutput(lines: string[]): string {
  // For npm/pip install output, the meaningful content is warnings, errors,
  // and the final summary. The bulk is per-package progress lines that say
  // nothing once the install succeeds.
  const interesting = lines.filter((l) =>
    /\b(warn|warning|error|err!|deprecated|vulnerabilit|added|removed|changed)\b/i.test(l),
  );
  const lastFive = lines.slice(-5);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of [...interesting, ...lastFive]) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out.join("\n");
}

function isInstallCommand(command: string | undefined): boolean {
  if (!command) return false;
  return /\b(npm|yarn|pnpm|pip|pip3|poetry|cargo|go)\s+(install|add|i)\b/.test(command);
}

// Recognize commands where the user has already narrowed the range of lines
// they want to see. For these, truncating further is wrong — they explicitly
// asked for those exact lines. The previous version would clip 61-line
// `sed -n '310,370p'` output to 40 lines + "[21 lines truncated]", forcing
// users to bypass cctx with a Python script to do the find-replace they wanted.
function isExplicitRangeCommand(command: string | undefined): boolean {
  if (!command) return false;
  // sed -n 'N,Mp' or sed -n "N,Mp" or sed -n Np
  if (/\bsed\s+-n\s+['"]?\d+(?:,\$?\d+)?p['"]?/.test(command)) return true;
  // awk 'NR==N,NR==M' or awk 'NR>=N && NR<=M'
  if (/\bawk\s+['"][^'"]*NR\s*(==|>=|<=|>|<)/.test(command)) return true;
  // head -n N or head -N (final lines explicit), tail -n N or tail -N
  if (/\b(head|tail)\s+(-n\s+)?-?\d+\b/.test(command)) return true;
  return false;
}

// Heuristic: does the command look like it's reading source code rather than
// log/build output? If so, we apply Read-style guards — corruption of code
// is high-impact and hard to spot.
function isSourceFileRead(command: string | undefined): boolean {
  if (!command) return false;
  // cat/sed/awk/head/tail of a path with a code-looking extension.
  return /\b(cat|sed|awk|head|tail|grep)\b[^|]*\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs|cpp|cc|c|h|hpp|swift|kt|sql|prisma|graphql|proto|yaml|yml|toml|json|jsonc)\b/i.test(command);
}

export function compressBash(input: CompressionInput): { text: string; strategy: string } {
  const cfg = loadConfig();
  const max = cfg.toolCompression.bashMaxOutputLines;
  const raw = input.rawOutput ?? "";
  const lines = raw.split("\n");
  const exitCode = input.exitCode ?? 0;

  if (raw.length < 500 && exitCode === 0) {
    return { text: raw, strategy: "bash:passthrough" };
  }

  // Honor explicit range-extraction commands — the user already narrowed
  // the output to exactly the lines they want. Pass raw on success.
  if (exitCode === 0 && isExplicitRangeCommand(input.command)) {
    return { text: raw, strategy: "bash:range-raw" };
  }

  // Source-file reads via cat/sed/awk are high-stakes — corrupting code by
  // ellipsis-truncation is exactly what drove users to bypass cctx with
  // python heredocs. Pass raw on success.
  if (exitCode === 0 && isSourceFileRead(input.command)) {
    return { text: raw, strategy: "bash:source-raw" };
  }

  if (isInstallCommand(input.command)) {
    return { text: compressInstallOutput(lines), strategy: "bash:install-summary" };
  }

  if (exitCode !== 0) {
    const filtered = filterStackFrames(lines);
    const top = head(filtered, 20);
    const bottom = tail(filtered, 10);
    const joined =
      filtered.length > 30
        ? [...top, `[${filtered.length - 30} lines truncated]`, ...bottom].join("\n")
        : filtered.join("\n");
    return { text: `Exit ${exitCode}\n${joined}`, strategy: "bash:error" };
  }

  if (lines.length > max + 10) {
    const top = head(lines, max);
    const bottom = tail(lines, 10);
    return {
      text: [...top, `[${lines.length - max - 10} lines truncated]`, ...bottom].join("\n"),
      strategy: "bash:truncate",
    };
  }

  return { text: raw, strategy: "bash:passthrough" };
}
