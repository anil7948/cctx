import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { paths, projectConfigPath, ensureCctxDirs, ensureProjectDirs } from "./paths.js";

export interface CctxConfig {
  version: 2;
  ollama: {
    binaryPath: string;
    port: number;
    managedByUser: boolean;
  };
  model: {
    active: string;
    installed: string[];
  };
  context: {
    verbatimTurnsWindow: "auto" | number;
    maxSummaryTokens: number;
    summarizationPrompt: "default" | string;
  };
  codebaseIndex: {
    enabled: boolean;
    extensions: string[];
    excludeDirs: string[];
    maxFileSizeKb: number;
    watchOnDaemon: boolean;
    indexingPrompt: "default" | string;
  };
  toolCompression: {
    enabled: boolean;
    alwaysRaw: string[];
    bashMaxOutputLines: number;
    grepMaxMatches: number;
    fileMinLinesForLLMSummary: number;
    compressionPrompt: "default" | string;
  };
  claudeCode: {
    mcpRegistered: boolean;
    slashCommandInstalled: boolean;
  };
  hardware: {
    /** Number of GPU layers for all Ollama inference calls.
     *  -1 = all available GPU layers (Metal on macOS, CUDA/ROCm on Linux — auto-detected by Ollama).
     *   0 = force CPU only (useful on headless servers without GPU).
     *  Ollama auto-detects GPU when this option is omitted; -1 makes it explicit. */
    numGpu: number;
    /** Number of files to process in parallel during `cctx index run`.
     *  Higher values speed up indexing on GPU at the cost of more memory.
     *  Default: 4 */
    indexingConcurrency: number;
  };
  memory: {
    /** Master kill switch for cross-session memory and session consolidation.
     *  Set to false to disable all LLM extraction calls beyond turn summarization. */
    enabled: boolean;
    /** Maximum project_knowledge entries to keep across sessions (LRU prune). Default: 20 */
    maxProjectKnowledge: number;
    /** Hard cap on session_knowledge rows per session. ADDs beyond this are skipped. Default: 30 */
    maxSessionKnowledge: number;
    /** Skip session consolidation until the session has at least N summarized turns. Default: 2 */
    consolidationMinTurns: number;
  };
}

export const DEFAULT_CONFIG: CctxConfig = {
  version: 2,
  ollama: {
    binaryPath: paths.ollamaBinary,
    port: 11435,
    managedByUser: false,
  },
  model: {
    active: "phi3.5",
    installed: [],
  },
  context: {
    verbatimTurnsWindow: 1,
    maxSummaryTokens: 2000,
    summarizationPrompt: "default",
  },
  codebaseIndex: {
    enabled: true,
    extensions: [
      // Web / JS ecosystem
      ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
      // Styles / markup
      ".css", ".scss", ".sass", ".less", ".html", ".htm",
      // Backend languages
      ".py", ".go", ".rs", ".java", ".kt", ".kts", ".rb", ".php",
      ".cs", ".fs", ".fsx", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp",
      ".swift", ".m", ".mm",
      // Shell / config / infra
      ".sh", ".bash", ".zsh", ".fish",
      ".yaml", ".yml", ".toml", ".json", ".jsonc", ".env",
      ".tf", ".hcl",
      // Docs
      ".md", ".mdx", ".rst", ".txt",
    ],
    excludeDirs: ["node_modules", ".git", "dist", "build", "__pycache__", ".next", ".cctx", "coverage", "target"],
    maxFileSizeKb: 200,
    watchOnDaemon: false,
    indexingPrompt: "default",
  },
  toolCompression: {
    enabled: true,
    alwaysRaw: ["*.test.ts", "*.test.js", "*.spec.ts", "*.spec.js"],
    bashMaxOutputLines: 30,
    grepMaxMatches: 50,
    fileMinLinesForLLMSummary: 50,
    compressionPrompt: "default",
  },
  claudeCode: {
    mcpRegistered: false,
    slashCommandInstalled: false,
  },
  hardware: {
    numGpu: -1,
    indexingConcurrency: 4,
  },
  memory: {
    enabled: true,
    maxProjectKnowledge: 20,
    maxSessionKnowledge: 30,
    consolidationMinTurns: 2,
  },
};

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (typeof base !== "object" || base === null) return (override as T) ?? base;
  if (Array.isArray(base)) return (override as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override ?? {})) {
    const baseVal = (base as Record<string, unknown>)[key];
    if (value !== undefined && typeof value === "object" && !Array.isArray(value) && value !== null && typeof baseVal === "object" && baseVal !== null) {
      out[key] = deepMerge(baseVal, value as Record<string, unknown>);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

function stripEphemeralFields(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.codebaseIndex && typeof raw.codebaseIndex === "object") {
    const ci = { ...(raw.codebaseIndex as Record<string, unknown>) };
    for (const field of EPHEMERAL_INDEX_FIELDS) delete ci[field];
    return { ...raw, codebaseIndex: ci };
  }
  return raw;
}

export function loadConfig(cwd: string = process.cwd()): CctxConfig {
  let cfg = DEFAULT_CONFIG;
  if (existsSync(paths.globalConfig)) {
    try {
      const raw = stripEphemeralFields(JSON.parse(readFileSync(paths.globalConfig, "utf8")));
      cfg = deepMerge(cfg, raw);
    } catch {
      // Corrupt global config — fall back to defaults rather than crashing.
    }
  }
  const projCfg = projectConfigPath(cwd);
  if (existsSync(projCfg)) {
    try {
      const raw = JSON.parse(readFileSync(projCfg, "utf8"));
      cfg = deepMerge(cfg, raw);
    } catch {
      // Same for project config.
    }
  }
  return cfg;
}

/** Fields that should never be persisted — they are code defaults and must stay live. */
const EPHEMERAL_INDEX_FIELDS: Array<keyof CctxConfig["codebaseIndex"]> = ["extensions", "excludeDirs"];

export function saveGlobalConfig(cfg: CctxConfig): void {
  ensureCctxDirs();
  const toSave: CctxConfig = { ...cfg, codebaseIndex: { ...cfg.codebaseIndex } };
  for (const field of EPHEMERAL_INDEX_FIELDS) {
    delete (toSave.codebaseIndex as Record<string, unknown>)[field];
  }
  writeFileSync(paths.globalConfig, JSON.stringify(toSave, null, 2) + "\n", "utf8");
}

export function saveProjectConfig(partial: Partial<CctxConfig>, cwd: string = process.cwd()): void {
  ensureProjectDirs(cwd);
  const path = projectConfigPath(cwd);
  let existing: Partial<CctxConfig> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      existing = {};
    }
  }
  const merged = deepMerge(existing as CctxConfig, partial);
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", "utf8");
}

export function setConfigValue(key: string, value: string): void {
  const cfg = loadConfig();
  const parts = key.split(".");
  let cursor: Record<string, unknown> = cfg as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i]!;
    const next = cursor[seg];
    if (typeof next !== "object" || next === null) {
      throw new Error(`Config path '${key}' does not exist (stopped at '${seg}')`);
    }
    cursor = next as Record<string, unknown>;
  }
  const leaf = parts[parts.length - 1]!;
  if (!(leaf in cursor)) {
    throw new Error(`Config path '${key}' does not exist (no key '${leaf}')`);
  }
  cursor[leaf] = coerce(value);
  saveGlobalConfig(cfg);
}

function coerce(v: string): string | number | boolean {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return Number.parseFloat(v);
  return v;
}

export function getConfigValue(key: string): unknown {
  const cfg = loadConfig();
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, cfg);
}
