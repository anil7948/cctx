import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { paths, projectConfigPath, ensureCctxDirs, ensureProjectDirs } from "./paths.js";

export const CONFIG_SCHEMA_VERSION = 3;

export interface CctxConfig {
  /** Schema version of the persisted config. Bumped when defaults change in a
   *  way that requires migrating existing user configs. See migrateConfig() for
   *  the per-version migration steps. */
  version: number;
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
    /** Estimated maximum context tokens for the Claude model in use.
     *  Used to calculate utilization % in get_optimized_context.
     *  Default: 180000 (Claude Sonnet 4.x / Opus 4.x context window) */
    maxTokens: number;
    /** Warn when estimated context utilization exceeds this fraction (0–1).
     *  Default: 0.75 (warn at 75% full) */
    compactWarningThreshold: number;
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
  version: CONFIG_SCHEMA_VERSION,
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
    maxTokens: 180000,
    compactWarningThreshold: 0.75,
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
    alwaysRaw: [
      "*.test.ts", "*.test.js", "*.spec.ts", "*.spec.js",
      // Schema/structured-data files: corruption of column or index names
      // here is high-impact and hard to spot. Always serve raw.
      "*.sql", "*.prisma", "*.graphql", "*.proto",
    ],
    bashMaxOutputLines: 120,
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

/**
 * Migrate a persisted user config from an older schema version to the current one.
 *
 * Runs automatically on every loadConfig() call when paths.globalConfig.version < CONFIG_SCHEMA_VERSION.
 * Each migration step is idempotent and additive: we replace values the old release
 * shipped as defaults (which are now known to be wrong/too aggressive) and merge in
 * new entries the user can't reasonably know to add (e.g. .sql in alwaysRaw).
 *
 * IMPORTANT: only overwrite a field when it still matches the old default. If the
 * user has tuned it deliberately, leave it alone. The whole point of this function
 * is to fix users who never touched their config; we must not stomp users who did.
 *
 * Returns the migrated config plus a `changed` flag so the caller can persist it.
 */
function migrateConfig(persisted: Record<string, unknown>): { migrated: Record<string, unknown>; changed: boolean } {
  const fromVersion = typeof persisted.version === "number" ? persisted.version : 0;
  if (fromVersion >= CONFIG_SCHEMA_VERSION) return { migrated: persisted, changed: false };

  // Shallow-clone top level + the nested blocks we may touch.
  const out: Record<string, unknown> = { ...persisted };
  const tc = { ...((out.toolCompression as Record<string, unknown>) ?? {}) };
  let touched = false;

  // v2 → v3:
  //  - bashMaxOutputLines: old default 30 was too aggressive; clipped legitimate
  //    code/config reads. New default is 120. Bump only if the persisted value
  //    still matches the old default (= user never tuned it).
  //  - alwaysRaw: add schema-shaped extensions (.sql, .prisma, .graphql, .proto)
  //    if they're missing. These were never compressible safely; the previous
  //    release just didn't list them.
  //  - fileMinLinesForLLMSummary: defunct setting (file:llm path removed) but
  //    leave it in place to avoid spurious diffs.
  if (fromVersion < 3) {
    if (tc.bashMaxOutputLines === 30) {
      tc.bashMaxOutputLines = 120;
      touched = true;
    }
    const ar = Array.isArray(tc.alwaysRaw) ? [...(tc.alwaysRaw as string[])] : [];
    const newEntries = ["*.sql", "*.prisma", "*.graphql", "*.proto"];
    let arChanged = false;
    for (const entry of newEntries) {
      if (!ar.includes(entry)) { ar.push(entry); arChanged = true; }
    }
    if (arChanged) {
      tc.alwaysRaw = ar;
      touched = true;
    }
  }

  if (touched) out.toolCompression = tc;
  out.version = CONFIG_SCHEMA_VERSION;
  // version bump alone is also a change to persist — keeps subsequent loads fast.
  return { migrated: out, changed: true };
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
      const persisted = JSON.parse(readFileSync(paths.globalConfig, "utf8")) as Record<string, unknown>;

      // Auto-migrate stale defaults from older releases. Runs once per upgrade:
      // after the migrated config is written back, fromVersion === CONFIG_SCHEMA_VERSION
      // on subsequent loads and the migration is a no-op. We do this BEFORE
      // stripEphemeralFields so the migration sees what the user actually persisted.
      const { migrated, changed } = migrateConfig(persisted);
      if (changed) {
        try {
          ensureCctxDirs();
          writeFileSync(paths.globalConfig, JSON.stringify(migrated, null, 2) + "\n", "utf8");
        } catch {
          // If we can't write back (read-only FS, permissions, etc.) the in-memory
          // migrated values still take effect for this process. The migration will
          // re-run next launch — still safe because the steps are idempotent.
        }
      }

      const raw = stripEphemeralFields(migrated);
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
