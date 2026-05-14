import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, openSync, unlinkSync } from "node:fs";
import { paths, ensureCctxDirs } from "../utils/paths.js";
import { OllamaClient, clientFromConfig } from "./client.js";
import { loadConfig } from "../utils/config.js";
import { log } from "../utils/logger.js";
import { CctxError } from "../utils/errors.js";

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  port: number;
  reachable: boolean;
  managedByUser: boolean;
}

// Linux max PID is 4194304 (2^22), macOS is 99998. Allow the Linux maximum
// as a conservative upper bound that covers all supported platforms.
const MAX_PID = 4_194_304;

function readPid(): number | null {
  if (!existsSync(paths.daemonPidFile)) return null;
  try {
    const content = readFileSync(paths.daemonPidFile, "utf8").trim();
    if (!content) return null;
    const pid = Number.parseInt(content, 10);
    if (!Number.isFinite(pid) || pid < 1 || pid > MAX_PID) {
      log.warn(`Ignoring invalid PID in ${paths.daemonPidFile}: ${JSON.stringify(content)}`);
      clearPid();
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  ensureCctxDirs();
  writeFileSync(paths.daemonPidFile, String(pid), "utf8");
}

function clearPid(): void {
  if (existsSync(paths.daemonPidFile)) {
    try {
      unlinkSync(paths.daemonPidFile);
    } catch {
      // ignore
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function daemonStatus(): Promise<DaemonStatus> {
  const cfg = loadConfig();
  const pid = readPid();
  const running = pid !== null && isAlive(pid);
  const client = clientFromConfig(cfg.ollama.port);
  const reachable = await client.ping();
  return {
    running,
    pid: running ? pid : null,
    port: cfg.ollama.port,
    reachable,
    managedByUser: cfg.ollama.managedByUser,
  };
}

export async function startDaemon(): Promise<DaemonStatus> {
  const cfg = loadConfig();
  if (cfg.ollama.managedByUser) {
    const client = clientFromConfig(cfg.ollama.port);
    const reachable = await client.ping();
    if (!reachable) {
      throw new CctxError(
        "EXTERNAL_OLLAMA_DOWN",
        `ollama.managedByUser is true but no Ollama is reachable on port ${cfg.ollama.port}`,
      );
    }
    return daemonStatus();
  }

  const existing = readPid();
  if (existing && isAlive(existing)) {
    return daemonStatus();
  }
  clearPid();

  if (!existsSync(cfg.ollama.binaryPath)) {
    throw new CctxError(
      "OLLAMA_NOT_INSTALLED",
      `Ollama binary not found at ${cfg.ollama.binaryPath}. Run 'cctx setup' first.`,
    );
  }

  ensureCctxDirs();
  const logFd = openSync(paths.daemonLog, "a");

  const env = {
    ...process.env,
    OLLAMA_HOST: `127.0.0.1:${cfg.ollama.port}`,
    OLLAMA_MODELS: paths.ollamaModels,
  };

  const child = spawn(cfg.ollama.binaryPath, ["serve"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env,
  });

  if (!child.pid) {
    throw new CctxError("DAEMON_START_FAILED", "Failed to spawn Ollama daemon");
  }
  writePid(child.pid);
  child.unref();

  // Wait for /api/tags to respond before returning. Ollama needs a couple of
  // seconds on cold start while it loads its model registry.
  const client = clientFromConfig(cfg.ollama.port);
  for (let i = 0; i < 30; i++) {
    if (await client.ping(500)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return daemonStatus();
}

export async function stopDaemon(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.ollama.managedByUser) {
    log.info("Ollama is user-managed; not stopping");
    return;
  }
  const pid = readPid();
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
    // Give it up to 5 seconds to exit cleanly.
    for (let i = 0; i < 10; i++) {
      if (!isAlive(pid)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    // Re-read PID file before SIGKILL: if the process was restarted between
    // SIGTERM and now, we'd be killing the wrong (recycled) PID.
    if (isAlive(pid) && readPid() === pid) {
      process.kill(pid, "SIGKILL");
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      // ESRCH = "no such process" — the daemon already exited, which is fine.
      log.warn("Error stopping daemon", e);
    }
  }
  clearPid();
}

export async function ensureDaemon(): Promise<OllamaClient> {
  const status = await daemonStatus();
  if (!status.reachable) {
    await startDaemon();
  }
  const cfg = loadConfig();
  return clientFromConfig(cfg.ollama.port);
}
