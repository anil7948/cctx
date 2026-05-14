import { existsSync, createWriteStream, chmodSync, statSync, unlinkSync } from "node:fs";
import { platform, arch } from "node:os";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request } from "undici";
import { paths, ensureCctxDirs } from "../utils/paths.js";
import { CctxError } from "../utils/errors.js";
import { log } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

// Ollama publishes platform-specific archives on its releases page. We pin
// against the `latest` redirect so users receive bug fixes automatically.
// Users who want a fixed version can set `ollama.binaryPath` to a custom location.
const RELEASE_BASE = "https://github.com/ollama/ollama/releases/latest/download";

function downloadUrl(): string {
  const p = platform();
  const a = arch();
  if (p === "darwin") return `${RELEASE_BASE}/ollama-darwin.tgz`;
  if (p === "linux" && a === "x64") return `${RELEASE_BASE}/ollama-linux-amd64.tar.zst`;
  if (p === "linux" && a === "arm64") return `${RELEASE_BASE}/ollama-linux-arm64.tar.zst`;
  if (p === "win32") return `${RELEASE_BASE}/ollama-windows-amd64.zip`;
  throw new CctxError("UNSUPPORTED_PLATFORM", `No Ollama binary available for ${p}/${a}`);
}

export function isOllamaInstalled(): boolean {
  if (!existsSync(paths.ollamaBinary)) return false;
  try {
    const stat = statSync(paths.ollamaBinary);
    return stat.size > 1024 * 1024;
  } catch {
    return false;
  }
}

export async function downloadOllama(onProgress?: (downloaded: number, total: number) => void): Promise<void> {
  ensureCctxDirs();
  const url = downloadUrl();
  log.info(`Downloading Ollama from ${url}`);

  let currentUrl = url;
  let redirects = 0;
  while (redirects < 10) {
    const res = await request(currentUrl, { method: "GET" });
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      const loc = Array.isArray(res.headers.location) ? res.headers.location[0]! : res.headers.location;
      currentUrl = loc;
      redirects++;
      await res.body.dump();
      continue;
    }
    if (res.statusCode !== 200) {
      throw new CctxError("DOWNLOAD_FAILED", `Failed to download Ollama: HTTP ${res.statusCode}`);
    }

    const total = Number.parseInt((res.headers["content-length"] as string) ?? "0", 10);
    let downloaded = 0;

    // Write to a temp path inside the same dir so rename is atomic.
    const tempFile = `${paths.bin}/ollama.tmp`;
    const out = createWriteStream(tempFile);

    try {
      res.body.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        if (onProgress) onProgress(downloaded, total);
      });
      await pipeline(res.body, out);

      // Verify we got a non-empty, plausible-sized file.
      const stat = statSync(tempFile);
      if (stat.size === 0) {
        throw new CctxError("DOWNLOAD_INCOMPLETE", "Downloaded file is empty");
      }
      if (total > 0 && Math.abs(stat.size - total) > 1024) {
        throw new CctxError(
          "DOWNLOAD_INCOMPLETE",
          `Downloaded ${stat.size} bytes but expected ${total}`,
        );
      }

      // Extract using execFile (array args — no shell interpolation).
      const p = platform();
      if (p === "darwin") {
        await execFileAsync("tar", ["-xzf", tempFile, "-C", paths.bin]);
      } else if (p === "linux") {
        await execFileAsync("tar", ["-xf", tempFile, "-C", paths.bin]);
      } else if (p === "win32") {
        await execFileAsync("unzip", ["-o", "-q", tempFile, "-d", paths.bin]);
      }
    } finally {
      // Always remove the temp archive, even on extraction failure.
      if (existsSync(tempFile)) {
        try {
          unlinkSync(tempFile);
        } catch {
          // ignore — best effort cleanup
        }
      }
    }

    chmodSync(paths.ollamaBinary, 0o755);
    return;
  }
  throw new CctxError("DOWNLOAD_FAILED", "Too many redirects while downloading Ollama");
}
