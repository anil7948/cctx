import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { paths } from "../utils/paths.js";
import { log } from "../utils/logger.js";

interface HookEntry {
  type: string;
  command: string;
}

interface HookGroup {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    Stop?: HookGroup[];
    [key: string]: HookGroup[] | undefined;
  };
  [key: string]: unknown;
}

const CCTX_HOOK_MARKER = "cctx session hook-stop";

function readSettings(): ClaudeSettings {
  if (!existsSync(paths.claudeSettings)) return {};
  try {
    const raw = JSON.parse(readFileSync(paths.claudeSettings, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return raw as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeSettings(cfg: ClaudeSettings): void {
  mkdirSync(dirname(paths.claudeSettings), { recursive: true });
  writeFileSync(paths.claudeSettings, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function registerStopHook(cctxBinaryPath: string): void {
  const cfg = readSettings();
  cfg.hooks = cfg.hooks ?? {};

  const newEntry: HookEntry = {
    type: "command",
    command: `${cctxBinaryPath} session hook-stop`,
  };

  // Find or create the Stop array.
  const existingStop: HookGroup[] = cfg.hooks.Stop ?? [];

  // Build a new Stop array:
  // 1. Keep all existing groups that contain no cctx entry (preserve user hooks).
  // 2. Remove any group whose only hook is the old cctx entry (idempotency cleanup).
  // 3. Append a clean group with the new cctx entry.
  const filtered = existingStop
    .map((group) => ({
      ...group,
      hooks: group.hooks.filter((h) => !h.command.includes(CCTX_HOOK_MARKER)),
    }))
    .filter((group) => group.hooks.length > 0);

  filtered.push({ matcher: "", hooks: [newEntry] });
  cfg.hooks.Stop = filtered;

  writeSettings(cfg);
  log.info(`Stop hook registered in ${paths.claudeSettings}`);
}

export function unregisterStopHook(): void {
  if (!existsSync(paths.claudeSettings)) return;
  const cfg = readSettings();
  if (!cfg.hooks?.Stop) return;

  const filtered = cfg.hooks.Stop
    .map((group) => ({
      ...group,
      hooks: group.hooks.filter((h) => !h.command.includes(CCTX_HOOK_MARKER)),
    }))
    .filter((group) => group.hooks.length > 0);

  if (filtered.length === 0) {
    delete cfg.hooks.Stop;
  } else {
    cfg.hooks.Stop = filtered;
  }

  writeSettings(cfg);
}

export function isStopHookRegistered(): boolean {
  if (!existsSync(paths.claudeSettings)) return false;
  const cfg = readSettings();
  const stop = cfg.hooks?.Stop ?? [];
  return stop.some((group) =>
    group.hooks.some((h) => h.command.includes(CCTX_HOOK_MARKER)),
  );
}
