import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import { loadConfig } from "../utils/config.js";

export interface WalkedFile {
  absPath: string;
  relPath: string;
  mtime: number;
  size: number;
}

function loadIgnore(root: string): Ignore {
  const ig = ignore();
  const gitignore = join(root, ".gitignore");
  if (existsSync(gitignore)) {
    try {
      ig.add(readFileSync(gitignore, "utf8"));
    } catch {
      // ignore
    }
  }
  const cctxignore = join(root, ".cctxignore");
  if (existsSync(cctxignore)) {
    try {
      ig.add(readFileSync(cctxignore, "utf8"));
    } catch {
      // ignore
    }
  }
  return ig;
}

export function walkProject(root: string, cwd: string = process.cwd()): WalkedFile[] {
  const cfg = loadConfig(cwd);
  const ig = loadIgnore(root);
  const excludeDirs = new Set(cfg.codebaseIndex.excludeDirs);
  const extensions = new Set(cfg.codebaseIndex.extensions);
  const maxBytes = cfg.codebaseIndex.maxFileSizeKb * 1024;
  const out: WalkedFile[] = [];

  const visit = (dir: string): void => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }) as unknown as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (!rel || rel.startsWith("..")) continue;
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        if (ig.ignores(rel + "/")) continue;
        visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (ig.ignores(rel)) continue;
      if (!extensions.has(extname(entry.name).toLowerCase())) continue;
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.size > maxBytes) continue;
      out.push({
        absPath: abs,
        relPath: rel,
        mtime: Math.floor(stat.mtimeMs),
        size: stat.size,
      });
    }
  };

  visit(root);
  return out;
}
