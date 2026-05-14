import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const HOME = homedir();

export const paths = {
  home: HOME,
  root: join(HOME, ".cctx"),
  cctxBin: join(HOME, ".cctx", "bin"),
  bin: join(HOME, ".cctx", "bin"),
  ollamaBinary: join(HOME, ".cctx", "bin", platform() === "win32" ? "ollama.exe" : "ollama"),
  ollamaModels: join(HOME, ".cctx", "models"),
  globalConfig: join(HOME, ".cctx", "config.json"),
  daemonPidFile: join(HOME, ".cctx", "daemon.pid"),
  daemonLog: join(HOME, ".cctx", "daemon.log"),
  cctxInstructions: join(HOME, ".cctx", "instructions.md"),
  claudeCodeConfig: join(HOME, ".claude", "claude_code_config.json"),
  claudeSettings: join(HOME, ".claude", "settings.json"),
  claudeCommandsDir: join(HOME, ".claude", "commands"),
  globalClaudeMd: join(HOME, ".claude", "CLAUDE.md"),
};

export function projectRoot(cwd: string = process.cwd()): string {
  return resolve(cwd);
}

export function projectStateDir(cwd: string = process.cwd()): string {
  return join(projectRoot(cwd), ".cctx");
}

export function projectConfigPath(cwd: string = process.cwd()): string {
  return join(projectStateDir(cwd), "config.json");
}

export function projectDbPath(cwd: string = process.cwd()): string {
  return join(projectStateDir(cwd), "sessions.db");
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function ensureCctxDirs(): void {
  ensureDir(paths.root);
  ensureDir(paths.bin);
  ensureDir(paths.ollamaModels);
}

export function ensureProjectDirs(cwd: string = process.cwd()): void {
  ensureDir(projectStateDir(cwd));
}
