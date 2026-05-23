import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fmt } from "./format.js";

const HOME = homedir();

const INSTRUCTIONS_FILE = join(HOME, ".cctx", "instructions.md");
const GLOBAL_CLAUDE_MD = join(HOME, ".claude", "CLAUDE.md");

const BEGIN = "<!-- cctx:instructions:begin -->";
const END = "<!-- cctx:instructions:end -->";

const CONTENT = `## cctx — Context Optimizer

You have access to the \`cctx\` MCP server. These tools are MANDATORY, not optional.

---

### REQUIRED: Session start

**Before your first response in any session**, call \`cctx\` → \`get_codebase_context\`. This replaces reading files one by one. Do not skip this even if you think you know the project.

---

### REQUIRED: Every turn end

**The last thing you do before finishing any response** is call \`cctx\` → \`record_turn\` with:
- \`prompt\`: the user's message
- \`response\`: your full reply

This is non-negotiable. A turn without \`record_turn\` is incomplete. Token savings are zero without it.

---

### REQUIRED: Large tool output

When any \`bash\`, \`read_file\`, or \`grep\` result exceeds ~100 lines, call \`cctx\` → \`compress_tool_result\` on the raw output before reasoning over it.

**Note:** A PostToolUse hook automatically compresses outputs >30 lines before they reach you. You will see a \`[cctx: ...]\` header on compressed results. No manual action needed for those — only call \`compress_tool_result\` manually if the hook did not fire or the output is still too large.

---

### On demand: Force compaction

Use \`/compact-local\` inside Claude Code, or call \`flush_session\` then \`get_optimized_context\`.
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
