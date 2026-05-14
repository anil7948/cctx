import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildProjectMap } from "../indexer/map-builder.js";
import { projectRoot } from "../utils/paths.js";
import { fmt } from "./format.js";

const BEGIN = "<!-- cctx:begin -->";
const END = "<!-- cctx:end -->";

export function injectClaudeMd(opts: { file?: string }): void {
  const target = opts.file ?? join(projectRoot(), "CLAUDE.md");
  const map = buildProjectMap();
  const block = `${BEGIN}\n## Project map (managed by cctx — do not edit)\n\n\`\`\`\n${map}\n\`\`\`\n${END}`;

  let existing = "";
  if (existsSync(target)) {
    existing = readFileSync(target, "utf8");
  }

  let next: string;
  if (existing.includes(BEGIN) && existing.includes(END)) {
    const start = existing.indexOf(BEGIN);
    const end = existing.indexOf(END) + END.length;
    next = existing.slice(0, start) + block + existing.slice(end);
  } else {
    next = existing.length > 0 ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
  }

  writeFileSync(target, next, "utf8");
  console.log(fmt.ok(`Wrote project map to ${target}`));
}
