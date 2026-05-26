# cctx — Claude Code Token Optimizer

**Reduce Claude Code token usage by 70–90% using a free, local LLM.**

`cctx` is a CLI tool + MCP server that runs three token-reduction layers alongside Claude Code — codebase indexing, tool output compression, and turn summarization — all powered by [Ollama](https://ollama.com) running on your machine. No API calls, no subscription fees, no config beyond `cctx setup`.


[![npm version](https://img.shields.io/npm/v/cctx-optimizer)](https://www.npmjs.com/package/cctx-optimizer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

---

## Why this exists

Claude Code's context window fills up fast. Every `bash` run, every file read, every `grep` result gets appended verbatim. By turn 15 you're paying for — and waiting on — tens of thousands of tokens of resolved history and raw tool noise that Claude no longer needs in full.

`cctx` intercepts that bloat at three layers using a small local LLM (phi3.5, 2.2 GB) that runs entirely on your machine:

| Layer | Problem | What cctx does | Typical savings |
|---|---|---|---|
| **1 — Codebase index** | Session start reads 15–25 files | Pre-built semantic file map served via MCP; query by topic to get only relevant files | ~90% on session start |
| **2 — Tool output compression** | `bash`/`read_file`/`grep` output appended raw | PostToolUse hook: rules-based + local LLM compression, auto-registered on setup | ~70% on agentic loops |
| **3 — Turn summarization** | History bloats over 10+ turns | Async structured JSON summary of each completed turn; session consolidation maintains current-truth decisions | ~83% on long sessions |
| **4 — Cross-session memory** | Context resets every session | Key decisions and patterns extracted at flush; injected into every future session automatically | Avoids re-explaining project state |

All four layers are automatic after `cctx setup`. You never call any tools yourself.

---

## What's new in v1.2.0

| Feature | What it does |
|---------|-------------|
| **FTS5 keyword search** | `get_codebase_context(query: "auth")` returns only relevant files — no paging through 186 files |
| **Context utilization monitor** | `get_optimized_context` reports % full; warns at 75% to compact before quality degrades |
| **Session checkpoints** | At flush, cctx synthesizes a "pick up where you left off" note injected at next session start |
| **Deterministic structural extraction** | File exports/imports now parsed by regex, not LLM — eliminates hallucinated APIs in context |
| **Safe compression guards** | Identifier-preservation guard blocks compression that drops or invents code symbols |
| **Zero-touch MCP upgrade** | `npm install -g cctx-optimizer` re-registers MCP server automatically — no `cctx setup` needed |

## What's new in v1.1.0

| Feature | What it does |
|---------|-------------|
| **Cross-session memory** | Facts extracted at flush stored in `project_knowledge`; persisted into every future `get_codebase_context` |
| **Session consolidation** | Per-turn ADD/UPDATE/NOOP distillation into `session_knowledge`; context always reflects current-truth decisions |
| **PostToolUse compress hook** | Auto-registered hook compresses `bash`/`read_file`/`grep` at 60–70% before output enters context |
| **Paginated codebase index** | 80K chars/page — no truncation on 100+ file projects |
| **Parallel indexer** | Configurable concurrency (default 4 files); large projects go from hours to minutes |
| **GPU acceleration** | Explicit `num_gpu` passthrough to all Ollama calls; auto-detects Metal/CUDA |

---

## Architecture

`cctx` runs as a local MCP server that Claude Code calls on every turn. There is no proxy, no cloud hop, and no change to how you use Claude Code. All three optimization layers operate in the background.

### The optimization pipeline

**Session start** — instead of Claude reading 15–25 files to orient itself, `get_codebase_context` returns a pre-computed semantic map of your project: purpose, exports, and key imports per file, built by a local LLM and cached in SQLite. Claude understands your codebase instantly without spending a single input token on raw file content.

**During tool calls** — when Claude runs `bash`, `grep`, a test suite, or reads a file, `compress_tool_result` intercepts the output before it enters context. Structured formats (bash exit code + lines, grep matches, test pass/fail + failing assertions) are compressed with deterministic rules at zero added latency. Unpredictable content (file bodies, web results) goes through the local LLM. The distinction matters: an agentic loop making 20 tool calls cannot afford 20 LLM round-trips. Rules handle the volume; the LLM handles the complexity.

**End of turn** — the Claude Code Stop hook fires `cctx session hook-stop`, which records the raw turn and queues async summarization. The local LLM converts the full turn into a structured JSON summary — preserving file paths, decisions, and open questions, discarding the rest. Each summary is roughly 10x smaller than the original.

**Next turn** — `get_optimized_context` assembles the session: all prior turns as compact summaries, plus the most recent turn verbatim. Claude picks up exactly where it left off, without re-reading resolved history.

> **On privacy:** every step above runs on your machine. Your code, your tool outputs, and your conversation history never leave your local environment.

---

## Requirements

- **Node.js 20+**
- **macOS, Linux, or Windows (WSL)** — [Ollama supports all three](https://ollama.com/download)
- **~2.5 GB free disk** for the default model (`phi3.5`)
- **[Claude Code](https://claude.ai/claude-code)** installed

---

## Quick start

```bash
npm install -g cctx-optimizer
cctx setup          # ~5 min on first run (model download is the slow part)
```

Restart Claude Code, then start coding. After your first session:

```bash
cctx session stats
```

That's it. See [Install and setup](#install-and-setup) for the full walkthrough.

---

## Setup & Integration

`cctx setup` is idempotent and non-destructive. It manages its own Ollama binary in `~/.cctx/bin/` on a dedicated port (`11435`), completely isolated from any existing Ollama installation. Safe to re-run at any time.

### Install

```bash
npm install -g cctx-optimizer
cctx setup
```

Or build from source:

```bash
git clone https://github.com/anil7948/cctx
cd cctx
npm install && npm run build && npm link
cctx setup
```

### What `cctx setup` does

The wizard runs eight steps and prints progress for each:

1. **Download Ollama** — fetches a managed binary to `~/.cctx/bin/`, isolated from any system Ollama you already have
2. **Start daemon** — launches Ollama on port `11435`
3. **Pull model** — downloads `phi3.5` (~2.2 GB — this is the slow step, runs once)
4. **Register MCP server** — writes to `~/.claude.json` (Claude Code 2.x); automatically refreshed on every `npm install -g` upgrade — no manual re-registration needed
5. **Register Stop hook** — writes to `~/.claude/settings.json` to record sessions on exit
6. **Write tool instructions** — writes `~/.cctx/instructions.md` and registers it via `~/.claude/CLAUDE.md`
7. **Index project** — builds the initial semantic map of your current project
8. **Smoke test** — verifies the full summarization pipeline end-to-end

Non-interactive mode:
```bash
cctx setup --model phi3.5 --yes
```

### After setup

1. **Restart Claude Code** — it reads the MCP config and instructions at launch
2. **Verify** — `cctx doctor` (all checks should be green)
3. **Index each project** — `cctx index run` in any project directory you work in

---

## Token savings: what to expect

| Session type | Layer 2 savings | Layer 3 savings | Total |
|---|---|---|---|
| Short session (1–3 turns) | Minimal | None | ~0% |
| Medium session (5–10 turns) | 50–70% on tool-heavy turns | 40–60% | 40–65% |
| Long agentic session (15+ turns) | 70–85% | 80–90% | 70–90% |

**Layer 2 only activates when Claude makes large tool calls.** Read-only or conversational sessions won't show compression numbers — this is expected.

**Layer 3 needs at least 3–4 turns before summaries exist.** Check `cctx session stats` after a real coding session, not after a quick question.

---

## Verify it's working

```bash
cctx doctor
```

Output:
```
✔  Ollama binary         ~/.cctx/bin/ollama
✔  Daemon running        pid 12345 port 11435
✔  Active model          phi3.5 installed
✔  Claude Code MCP       registered
✔  Stop hook             registered (~/.claude/settings.json)
✔  Codebase index        57 files, last run 2026-05-15T10:00:00Z
✔  Summarizer            1.3s
```

Watch live savings during a session:

```bash
cctx session stats --watch    # refreshes every 3 seconds
```

---

## Commands

### Setup and lifecycle

| Command | Description |
|---|---|
| `cctx setup [--model <name>] [--yes]` | One-time wizard. Safe to re-run — all steps are idempotent. |
| `cctx daemon start\|stop\|status\|restart` | Manage the background Ollama daemon. |
| `cctx doctor` | Health check with per-check fix hints. |
| `cctx register-instructions` | Re-register tool instructions after reinstalls or Claude Code updates. |
| `cctx uninstall [--keep-models]` | Remove daemon, config, Stop hook, instructions, and optionally models. |

### Models

```
cctx model list
cctx model set <name>
cctx model pull <name>
cctx model remove <name>
```

The default model is `phi3.5` (2.2 GB), which has been tested and confirmed to work reliably with cctx's JSON summarization pipeline. It runs on CPU without a GPU and uses one automatically when available.

Support for additional Ollama models is planned. Any model available at [ollama.com/library](https://ollama.com/library) can be pulled and set via `cctx model pull <name> && cctx model set <name>`, though JSON output reliability may vary by model.

Switch models: `cctx model pull <name> && cctx model set <name> && cctx daemon restart`

### Codebase index (Layer 1)

```
cctx index run [--path <dir>] [--force]
    Index changed files. Shows (N/total) progress per file.
    First run: ~5-8s per file on CPU. Subsequent runs skip unchanged files.

cctx index status
    Show indexed file count, pending changes, last run time.

cctx index watch [--path <dir>]
    Watch for file saves and re-index automatically. Reports each batch.
```

Use `--force` to regenerate all summaries (e.g. after switching models).

### Sessions (Layer 3)

```
cctx session list                                    List sessions with turn count
cctx session stats [--session-id <id>] [--watch]    Token savings breakdown; --watch refreshes live
cctx session flush [--session-id <id>]              Force summarization of pending turns
cctx session export [--format json|md] [--out file] Export summaries + codebase map
```

### Force context compaction mid-session

```
/compact-local
```

Inside Claude Code, or from a shell: `cctx session flush`

### CLAUDE.md injection

```
cctx inject [--file CLAUDE.md]
```

Writes the semantic project map into a managed block in `CLAUDE.md`. Useful for projects where you want the map baked in even without the MCP server active.

### Config

```
cctx config show
cctx config get <key>       # e.g. cctx config get model.active
cctx config set <key> <val> # e.g. cctx config set ollama.port 11436
```

Keys are dotted paths. Values auto-coerce (`true`/`false` → boolean, numeric strings → number).

---

## Configuration reference

Global config: `~/.cctx/config.json`. Per-project overrides: `<project>/.cctx/config.json`. Project values deep-merge over globals.

| Key | Default | Description |
|---|---|---|
| `ollama.port` | `11435` | Separate from system Ollama on `11434` |
| `ollama.managedByUser` | `false` | Set `true` to use your own Ollama instance |
| `model.active` | `phi3.5` | Model for summarization and compression |
| `context.verbatimTurnsWindow` | `1` | Recent turns kept verbatim; rest are summarized |
| `codebaseIndex.extensions` | TS/JS/PY/Go/Rust/etc. | File types to index (see config.ts for full list) |
| `codebaseIndex.excludeDirs` | node_modules, dist, etc. | Directories to skip |
| `toolCompression.alwaysRaw` | `["*.test.*","*.spec.*"]` | Globs never compressed |
| `toolCompression.fileMinLinesForLLMSummary` | `50` | Files shorter than this pass through raw |

---

## Storage layout

```
~/.cctx/
├── bin/ollama              managed Ollama binary (separate from system install)
├── models/                 model weights
├── config.json             global config
├── instructions.md         tool instructions (auto-imported by Claude Code)
├── daemon.pid              pid of managed daemon
└── daemon.log              daemon stderr

~/.claude/
├── claude_code_config.json MCP server registration
├── settings.json           Stop hook (records sessions when Claude Code exits)
├── CLAUDE.md               @-imports ~/.cctx/instructions.md
└── commands/compact-local.md  /compact-local slash command

<project>/.cctx/
├── config.json             project-level config overrides
└── sessions.db             SQLite: sessions, turns, summaries, file index, stats
```

Delete `<project>/.cctx/sessions.db` to start fresh. `cctx uninstall` removes everything under `~/.cctx/`.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| **`cctx doctor` shows red checks** | Run the command in the `→` hint next to each failing check. |
| **Daemon won't start** | Check `~/.cctx/daemon.log`. Most common: port conflict. Fix: `cctx config set ollama.port 11436 && cctx daemon start` |
| **Model pull stalls** | Retry: `cctx model pull <name>`. Large models timeout on slow connections — phi3.5 (2.2 GB) needs a stable connection. |
| **Claude Code doesn't see MCP tools** | Restart Claude Code — it reads the MCP config at launch. If still missing: `cctx setup` re-registers. |
| **Session stats shows 0 turns recorded** | Stop hook not registered or not firing. Run `cctx doctor` — if "Stop hook" is red, run `cctx setup`. |
| **Savings are 0% after a session** | Check session length. Savings require 5+ turns with substantial tool output. Layer 2 only activates on large tool calls. |
| **Summarizer produces bad/truncated output** | Switch to a larger model: `cctx model set gemma3:7b && cctx daemon restart` |
| **`cctx index run` is very slow on first run** | Expected on CPU-only machines (~5–8 s/file). With a GPU, Ollama uses it automatically and indexing is significantly faster. 60 files on CPU ≈ 6 min. Subsequent runs skip unchanged files. |
| **High memory or slow generation** | Switch to a smaller model: `cctx model set phi3.5`. Or: `cctx config set context.verbatimTurnsWindow 1` |
| **Use your own Ollama** | `cctx config set ollama.managedByUser true && cctx config set ollama.port 11434 && cctx daemon stop` |

---

## How the compression works

**Layer 2 — tool output compression** dispatches by output type:

- **`bash`** (rules-based, zero latency): trims install noise, caps long output at 30 lines, preserves full error context on non-zero exit
- **`grep`** (rules-based): caps at 50 matches, adds a count of omitted lines
- **`test_runner`** (rules-based): on pass → one-line summary; on fail → failed test + assertion diff + first 5 non-`node_modules` stack frames
- **`read_file`** (cache-hit or LLM): if the file is in the index and unchanged, returns the cached summary instantly at zero LLM cost; otherwise runs the local LLM
- **`web`** (LLM): extracts key facts, source URLs, and relevant numbers

**Layer 3 — turn summarization** runs asynchronously after each turn completes. It produces structured JSON preserving file paths, function names, decisions, and open questions — discarding pleasantries and superseded plans. Each summary is ~10× smaller than the raw turn.

**Layer 1 — codebase index** walks the project respecting `.gitignore`, sends each file to the local LLM, and stores `{ purpose, exports, key_imports, side_effects, notes }` per file in SQLite. Incremental — only changed files are re-indexed on subsequent runs.

---


## Supported languages

Default indexed extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.vue`, `.svelte`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.rb`, `.php`, `.cs`, `.cpp`, `.c`, `.swift`, `.sh`, `.yaml`, `.toml`, `.json`, `.tf`, `.md`, and more. Add custom extensions via `codebaseIndex.extensions` in `.cctx/config.json`.

---

## Uninstall

```bash
cctx uninstall              # removes daemon, config, hooks, instructions, models
npm uninstall -g cctx-optimizer   # removes the CLI
```

`--keep-models` preserves `~/.cctx/models/` so a future reinstall skips the model download.

---

## Contributing

Issues and PRs welcome. The codebase is organized as:

```
src/
├── cli/          CLI commands (setup, daemon, session, index, doctor, ...)
├── mcp/          MCP server + 11 tool definitions
├── indexer/      Layer 1: file walker, LLM summarizer, map builder
├── compressor/   Layer 2: per-tool dispatcher and compression strategies
├── summarizer/   Layer 3: turn summarization engine and async queue
├── ollama/       Daemon manager, binary installer, REST client
├── store/        SQLite repositories (sessions, turns, summaries, file index)
└── utils/        Config, paths, logger, tokenizer, error types
```

```bash
npm install
npm run dev       # watch mode
npm run build     # one-time build
npm run typecheck # type check only
```

---

<!-- keywords: reduce claude tokens, claude code context window full, save claude api cost, mcp server for claude code, claude code slow large projects, ollama mcp, local llm context compression, cross-session memory, session consolidation, posttooluse hook, context utilization monitor, session checkpoint, phi3.5 ollama, reduce claude code costs, gpu accelerated indexing, claude code 2.x mcp, zero-touch upgrade, codebase semantic index, fts5 search, claude token optimization -->

## License

MIT
