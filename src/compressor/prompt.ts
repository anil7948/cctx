export const TOOL_COMPRESS_SYSTEM = `You compress tool output for a software development AI assistant. \
You preserve every symbol, value, error, file path, line number, and type. \
You remove boilerplate, license headers, blank lines, verbose logging, and comments that restate the code.`;

export function buildToolCompressPrompt(toolName: string, rawOutput: string): string {
  return `Compress this tool output to the minimum information needed to continue the task correctly.
Preserve: symbols, values, errors, file paths, line numbers, types.
Remove: comments, blank lines, boilerplate, license headers, verbose logging.

Tool: ${toolName}
Raw output:
\`\`\`
${rawOutput}
\`\`\`

Respond ONLY with the compressed version. No explanation, no markdown fence.`;
}
