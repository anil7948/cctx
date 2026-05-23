// Local models routinely violate the "respond with only JSON" instruction by
// wrapping the JSON in markdown fences or appending a trailing apology. We
// extract the first balanced JSON object and parse that, instead of trusting
// the response to already be valid JSON.

export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in response");

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        return JSON.parse(slice);
      }
    }
  }
  throw new Error("Unbalanced JSON object in response");
}

/** Extract the first balanced JSON array from text (handles markdown fences, preambles).
 *  Used when the LLM returns a bare `[...]` instead of a wrapped `{"actions":[...]}`. */
export function extractFirstJsonArray(text: string): unknown[] {
  const start = text.indexOf("[");
  if (start === -1) throw new Error("No JSON array found in response");

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        const parsed = JSON.parse(slice);
        if (!Array.isArray(parsed)) throw new Error("Parsed value is not an array");
        return parsed;
      }
    }
  }
  throw new Error("Unbalanced JSON array in response");
}

/** Unwrap a common LLM envelope pattern: `{"actions":[...]}` → the inner array.
 *  If the value is already an array, returns it as-is.
 *  phi3.5 frequently wraps arrays in a top-level object key. */
export function unwrapEnvelope(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["actions", "items", "knowledge", "results", "entries"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  throw new Error("Cannot unwrap envelope: value is not an array and has no known array key");
}
