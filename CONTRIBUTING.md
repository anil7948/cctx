# Contributing to cctx

Thanks for your interest. Contributions are welcome — bug fixes, new compression strategies, model support improvements, and documentation.

## Setup

```bash
git clone <repo>
cd cctx
npm install
npm run dev    # TypeScript watch mode
```

## Project structure

```
src/
├── cli/          CLI commands: setup, daemon, session, index, doctor, config
├── mcp/          MCP server and 11 tool definitions
├── indexer/      Layer 1: file walker, LLM summarizer, semantic map builder
├── compressor/   Layer 2: per-tool compression dispatcher and strategies
├── summarizer/   Layer 3: turn summarization engine and async queue
├── ollama/       Daemon manager, binary installer, REST client
├── store/        SQLite repositories (sessions, turns, summaries, file index)
└── utils/        Config, paths, logger, tokenizer, error types
```

## Before submitting a PR

- `npm run build` must pass (zero TypeScript errors)
- `npm run typecheck` must pass
- If your change touches compression logic, add a short description of what output formats it handles and what it drops

## What we won't merge

- Changes that add network calls outside of Ollama's local REST API
- Changes that require user credentials or external APIs
- Compression strategies that might drop error messages or line numbers (precision over size)

## Reporting a security issue

Please email rather than open a public issue. See [SECURITY.md](SECURITY.md).
