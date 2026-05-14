export const FILE_INDEX_SYSTEM = `You are a codebase indexer. You summarize source files for use as project context by an AI coding assistant. \
You produce strict JSON with no commentary, preserving every exported symbol and key dependency.`;

export function buildFileIndexPrompt(filePath: string, content: string): string {
  return `Summarize this source file for use as project context. Preserve all exported symbols, key imports, and the primary purpose. Omit implementation details that can be re-read.

File: ${filePath}
Content:
\`\`\`
${content}
\`\`\`

Respond ONLY with this JSON, no other text:
{
  "purpose": "one sentence — what this file does",
  "exports": ["exported functions, classes, types, constants"],
  "key_imports": ["important dependencies this file relies on"],
  "side_effects": ["module-level side effects: server start, DB connection, etc"],
  "notes": "any non-obvious architectural decisions or gotchas"
}`;
}
