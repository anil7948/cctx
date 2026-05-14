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

export function compressBash(input: CompressionInput): { text: string; strategy: string } {
  const cfg = loadConfig();
  const max = cfg.toolCompression.bashMaxOutputLines;
  const raw = input.rawOutput ?? "";
  const lines = raw.split("\n");
  const exitCode = input.exitCode ?? 0;

  if (raw.length < 500 && exitCode === 0) {
    return { text: raw, strategy: "bash:passthrough" };
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
