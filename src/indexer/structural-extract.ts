// Deterministic structural extraction for indexed file summaries.
//
// The previous indexer asked a small local LLM to list a file's exports,
// imports, and side effects. The model frequently invented entries
// (listing imports as exports, listing internal helpers as exports) and
// those wrong summaries were then served to Claude via the cache-hit path
// of the Read compressor. Replacing the LLM with a regex pass guarantees
// the structural fields cannot drift from the file.
//
// We support TS/JS/Python/Go because those cover the project's own
// extensions and the most common user codebases. For other languages we
// fall back to "unknown" rather than guess; the file is still indexed
// and the prose summary still runs.

export interface StructuralSummary {
  exports: string[];
  key_imports: string[];
  side_effects: string[];
}

const EMPTY: StructuralSummary = { exports: [], key_imports: [], side_effects: [] };

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function stripComments(src: string): string {
  // Remove /* ... */ blocks and // line comments. Not a full parser, but
  // good enough to keep keywords inside comments from being captured.
  // Python # comments handled by the python branch directly.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function extractTsJs(src: string): StructuralSummary {
  const cleaned = stripComments(src);
  const exports: string[] = [];
  const imports: string[] = [];

  // export const|let|var|function|class|interface|type|enum NAME
  const namedDecl = /\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of cleaned.matchAll(namedDecl)) exports.push(m[1]!);

  // export default ... — record as "default"
  if (/\bexport\s+default\b/.test(cleaned)) exports.push("default");

  // export { a, b as c }
  const exportList = /\bexport\s*\{([^}]+)\}/g;
  for (const m of cleaned.matchAll(exportList)) {
    const inner = m[1]!;
    for (const part of inner.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // "a as b" — the exported name is b
      const asMatch = trimmed.match(/^[A-Za-z_$][\w$]*\s+as\s+([A-Za-z_$][\w$]*)/);
      if (asMatch) {
        exports.push(asMatch[1]!);
        continue;
      }
      const nameMatch = trimmed.match(/^([A-Za-z_$][\w$]*)/);
      if (nameMatch) exports.push(nameMatch[1]!);
    }
  }

  // module.exports.foo = ... and exports.foo = ...
  const cjsNamed = /\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
  for (const m of cleaned.matchAll(cjsNamed)) exports.push(m[1]!);

  // module.exports = { a, b } — extract the keys
  const cjsObject = /\bmodule\.exports\s*=\s*\{([^}]+)\}/g;
  for (const m of cleaned.matchAll(cjsObject)) {
    for (const part of m[1]!.split(",")) {
      const key = part.split(":")[0]!.trim();
      const nameMatch = key.match(/^([A-Za-z_$][\w$]*)/);
      if (nameMatch) exports.push(nameMatch[1]!);
    }
  }

  // import ... from "spec"
  const importFrom = /\bimport\s+(?:[^;'"`]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of cleaned.matchAll(importFrom)) imports.push(m[1]!);

  // require("spec")
  const req = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of cleaned.matchAll(req)) imports.push(m[1]!);

  return {
    exports: dedupe(exports),
    key_imports: dedupe(imports).slice(0, 20),
    side_effects: [],
  };
}

function extractPython(src: string): StructuralSummary {
  // Strip # comments per line.
  const cleaned = src
    .split("\n")
    .map((l) => l.replace(/(^|[^#])#[^\n]*/g, "$1"))
    .join("\n");

  const exports: string[] = [];
  const imports: string[] = [];

  // Top-level `def NAME(` and `class NAME(` and `async def NAME(`. Anything
  // beginning a line (no indent) is module-level. Names starting with _
  // are conventionally private and omitted.
  const topLevel = /^(?:async\s+)?(?:def|class)\s+([A-Za-z][\w]*)/gm;
  for (const m of cleaned.matchAll(topLevel)) {
    const name = m[1]!;
    if (!name.startsWith("_")) exports.push(name);
  }

  // `import x` and `from x import y`
  const imp1 = /^\s*import\s+([\w.]+)/gm;
  for (const m of cleaned.matchAll(imp1)) imports.push(m[1]!);
  const imp2 = /^\s*from\s+([\w.]+)\s+import\s+/gm;
  for (const m of cleaned.matchAll(imp2)) imports.push(m[1]!);

  // Honor __all__ if present — that's the explicit public API.
  const allMatch = cleaned.match(/__all__\s*=\s*\[([^\]]+)\]/);
  if (allMatch) {
    const explicit: string[] = [];
    for (const part of allMatch[1]!.split(",")) {
      const m = part.match(/["']([^"']+)["']/);
      if (m) explicit.push(m[1]!);
    }
    if (explicit.length > 0) {
      return { exports: dedupe(explicit), key_imports: dedupe(imports).slice(0, 20), side_effects: [] };
    }
  }

  return {
    exports: dedupe(exports),
    key_imports: dedupe(imports).slice(0, 20),
    side_effects: [],
  };
}

function extractGo(src: string): StructuralSummary {
  const cleaned = stripComments(src);
  const exports: string[] = [];
  const imports: string[] = [];

  // Exported = starts with uppercase in Go.
  const funcDecl = /\bfunc\s+(?:\([^)]*\)\s+)?([A-Z][\w]*)\s*\(/g;
  for (const m of cleaned.matchAll(funcDecl)) exports.push(m[1]!);
  const typeDecl = /\btype\s+([A-Z][\w]*)/g;
  for (const m of cleaned.matchAll(typeDecl)) exports.push(m[1]!);
  const varDecl = /\b(?:var|const)\s+([A-Z][\w]*)/g;
  for (const m of cleaned.matchAll(varDecl)) exports.push(m[1]!);

  // import "path" and import ( "path" "path" )
  const single = /^\s*import\s+(?:[A-Za-z_]\w*\s+)?["]([^"]+)["]/gm;
  for (const m of cleaned.matchAll(single)) imports.push(m[1]!);
  const block = /\bimport\s*\(([^)]+)\)/g;
  for (const m of cleaned.matchAll(block)) {
    for (const line of m[1]!.split("\n")) {
      const pm = line.match(/["]([^"]+)["]/);
      if (pm) imports.push(pm[1]!);
    }
  }

  return {
    exports: dedupe(exports),
    key_imports: dedupe(imports).slice(0, 20),
    side_effects: [],
  };
}

export function extractStructural(filePath: string, content: string): StructuralSummary {
  const lower = filePath.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(lower)) return extractTsJs(content);
  if (/\.py$/.test(lower)) return extractPython(content);
  if (/\.go$/.test(lower)) return extractGo(content);
  return EMPTY;
}
