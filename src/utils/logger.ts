import chalk from "chalk";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function currentLevel(): Level {
  const env = (process.env.CCTX_LOG_LEVEL ?? "info").toLowerCase();
  return (["debug", "info", "warn", "error"] as Level[]).includes(env as Level) ? (env as Level) : "info";
}

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel()];
}

function fmt(level: Level, msg: string): string {
  const tag = {
    debug: chalk.gray("debug"),
    info: chalk.cyan("info "),
    warn: chalk.yellow("warn "),
    error: chalk.red("error"),
  }[level];
  return `${chalk.gray(new Date().toISOString())} ${tag} ${msg}`;
}

// MCP servers communicate over stdio; logging to stdout corrupts the protocol.
// All log output goes to stderr.
function write(line: string): void {
  process.stderr.write(line + "\n");
}

export const log = {
  debug(msg: string, meta?: unknown): void {
    if (!shouldLog("debug")) return;
    write(fmt("debug", meta ? `${msg} ${safeJson(meta)}` : msg));
  },
  info(msg: string, meta?: unknown): void {
    if (!shouldLog("info")) return;
    write(fmt("info", meta ? `${msg} ${safeJson(meta)}` : msg));
  },
  warn(msg: string, meta?: unknown): void {
    if (!shouldLog("warn")) return;
    write(fmt("warn", meta ? `${msg} ${safeJson(meta)}` : msg));
  },
  error(msg: string, err?: unknown): void {
    if (!shouldLog("error")) return;
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : err ? safeJson(err) : "";
    write(fmt("error", detail ? `${msg} — ${detail}` : msg));
  },
};

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
