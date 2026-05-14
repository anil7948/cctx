import chalk from "chalk";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export const fmt = {
  ok: (msg: string) => chalk.green("✔") + " " + msg,
  warn: (msg: string) => chalk.yellow("!") + " " + msg,
  err: (msg: string) => chalk.red("✗") + " " + msg,
  info: (msg: string) => chalk.cyan("·") + " " + msg,
  dim: (msg: string) => chalk.gray(msg),
  bold: (msg: string) => chalk.bold(msg),
};
