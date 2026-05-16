import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fmt } from "./format.js";

const HOME = homedir();

const INSTRUCTIONS_FILE = join(HOME, ".cctx", "instructions.md");
const GLOBAL_CLAUDE_MD = join(HOME, ".claude", "CLAUDE.md");

const BEGIN = "<!-- cctx:instructions:begin -->";
const END = "<!-- cctx:instructions:end -->";

const CONTENT = `## cctx — Context Optimizer Instructions

You have access to the \`cctx\` MCP server. Use these tools to reduce token usage:

### At the start of the first turn in a session
Call \`get_codebase_context\` to load the project map instead of reading files one by one.

### At the start of each subsequent turn
Call \`get_optimized_context\` to reconstruct compressed history: summarized older turns plus the single most recent verbatim turn. Use this instead of relying on raw conversation history to keep context lean.

### During tool calls with large output
When a \`bash\`, \`read_file\`, or \`grep\` result exceeds ~30 lines, call \`compress_tool_result\` before reasoning over it.

### At the end of every turn
Call \`record_turn\` with \`prompt\` (user message) and \`response\` (your full reply). This is the most important step — without it, no session history is stored and token savings are zero.

### To force compaction mid-session
Use \`/compact-local\` or call \`flush_session\` then \`get_optimized_context\`.

### Switching tasks
Call \`new_session\` when switching to an unrelated task in the same Claude Code window, so summaries from one task don't bleed into the next.
`;

export function registerGlobalInstructions(): void {
  // Write instructions to ~/.cctx/instructions.md
  mkdirSync(dirname(INSTRUCTIONS_FILE), { recursive: true });
  writeFileSync(INSTRUCTIONS_FILE, CONTENT, "utf8");

  // Inject a single @-import line into ~/.claude/CLAUDE.md using block markers
  const block = `${BEGIN}\n@~/.cctx/instructions.md\n${END}`;

  mkdirSync(dirname(GLOBAL_CLAUDE_MD), { recursive: true });
  const existing = existsSync(GLOBAL_CLAUDE_MD)
    ? readFileSync(GLOBAL_CLAUDE_MD, "utf8")
    : "";

  let next: string;
  if (existing.includes(BEGIN) && existing.includes(END)) {
    const start = existing.indexOf(BEGIN);
    const end = existing.indexOf(END) + END.length;
    next = existing.slice(0, start) + block + existing.slice(end);
  } else {
    next = existing.length > 0
      ? `${existing.trimEnd()}\n\n${block}\n`
      : `${block}\n`;
  }

  writeFileSync(GLOBAL_CLAUDE_MD, next, "utf8");
  console.log(fmt.ok(`Registered cctx instructions in ${GLOBAL_CLAUDE_MD}`));
}

export function unregisterGlobalInstructions(): void {
  if (!existsSync(GLOBAL_CLAUDE_MD)) return;
  const existing = readFileSync(GLOBAL_CLAUDE_MD, "utf8");
  if (!existing.includes(BEGIN)) return;

  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END) + END.length;
  // Remove the block plus any leading blank line
  const before = existing.slice(0, start).replace(/\n\n$/, "\n");
  const after = existing.slice(end);
  const next = (before + after).trim();

  if (next.length === 0) {
    // File only had cctx block — remove the file
    rmSync(GLOBAL_CLAUDE_MD);
  } else {
    writeFileSync(GLOBAL_CLAUDE_MD, next + "\n", "utf8");
  }
  console.log(fmt.ok(`Removed cctx instructions block from ${GLOBAL_CLAUDE_MD}`));
}
