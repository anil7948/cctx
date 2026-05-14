// Split a file into chunks for summarization when it's larger than the model
// can comfortably handle in a single pass. We split on top-level declaration
// boundaries (function, class, const at column 0) when possible — never in the
// middle of a logical unit. If no such boundaries exist, fall back to fixed
// 200-line slices, since the model is more forgiving of arbitrary cuts in
// data-heavy files (CSS, large JSON-shaped configs) than in code with nested
// scope.

const MAX_LINES_PER_CHUNK = 100;
const TOP_LEVEL_RE = /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum|def|fn|impl|struct|trait|public|private|protected|module|package)\b/;

export function chunkFile(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length <= MAX_LINES_PER_CHUNK) return [content];

  const boundaries: number[] = [0];
  for (let i = 1; i < lines.length; i++) {
    if (TOP_LEVEL_RE.test(lines[i]!)) boundaries.push(i);
  }
  boundaries.push(lines.length);

  if (boundaries.length <= 2) {
    return sliceFixed(lines);
  }

  // Accumulate boundaries into chunks that stay under MAX_LINES_PER_CHUNK.
  // Flush whenever adding the next boundary segment would exceed the limit.
  const chunks: string[] = [];
  let chunkStart = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const segEnd = boundaries[i]!;
    if (segEnd - chunkStart > MAX_LINES_PER_CHUNK && chunkStart < boundaries[i - 1]!) {
      // Flush everything up to the previous boundary
      chunks.push(lines.slice(chunkStart, boundaries[i - 1]!).join("\n"));
      chunkStart = boundaries[i - 1]!;
    }
  }
  if (chunkStart < lines.length) chunks.push(lines.slice(chunkStart).join("\n"));

  // A single boundary segment larger than the limit still needs fixed slicing
  return chunks.flatMap((c) => {
    const ls = c.split("\n");
    return ls.length > MAX_LINES_PER_CHUNK ? sliceFixed(ls) : [c];
  });
}

function sliceFixed(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += MAX_LINES_PER_CHUNK) {
    out.push(lines.slice(i, i + MAX_LINES_PER_CHUNK).join("\n"));
  }
  return out;
}
