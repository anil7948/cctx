import type { CompressionInput } from "./types.js";

const SUMMARY_RE = /(\d+\s+passing|\d+\s+passed|\d+\s+failed|\d+\s+failing|Tests:\s+|Suites:\s+|PASS|FAIL\s)/i;
const FAIL_RE = /(✗|✘|FAIL|failed|×)\s/;
const ASSERTION_RE = /(expected|received|to\s+equal|to\s+be|AssertionError|toEqual|toMatch|toBe)\b/i;

export function compressTestRunner(input: CompressionInput): { text: string; strategy: string } {
  const lines = input.rawOutput.split("\n");
  const exitCode = input.exitCode ?? 0;
  const summaryLines = lines.filter((l) => SUMMARY_RE.test(l));

  // Passing run with many tests — collapse to a one-line summary.
  if (exitCode === 0 && lines.length > 30) {
    const summary = summaryLines.slice(-3).join("\n") || lines.slice(-3).join("\n");
    return { text: summary, strategy: "test:pass-summary" };
  }

  if (exitCode !== 0) {
    const failures: string[] = [];
    const seenContexts = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (FAIL_RE.test(line) || ASSERTION_RE.test(line)) {
        // Capture 2 lines before + 5 lines after for context.
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 6);
        for (let j = start; j < end; j++) {
          if (seenContexts.has(j)) continue;
          seenContexts.add(j);
          failures.push(lines[j]!);
        }
      }
    }
    // Drop node_modules stack frames.
    const filtered = failures.filter((l) => !/\/node_modules\//.test(l));
    const final = filtered.slice(0, 80);
    const summary = summaryLines.slice(-3).join("\n");
    const text = [summary, "", ...final].filter(Boolean).join("\n");
    return { text, strategy: "test:fail-extract" };
  }

  return { text: input.rawOutput, strategy: "test:passthrough" };
}
