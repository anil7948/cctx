import { request } from "undici";
import { CctxError } from "../utils/errors.js";

export interface GenerateOptions {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  format?: "json";
  numCtx?: number;
  timeoutMs?: number;
}

export interface GenerateResult {
  response: string;
  totalDurationMs: number;
  evalCount: number;
}

export class OllamaClient {
  constructor(private readonly baseUrl: string) {}

  async ping(timeoutMs = 1500): Promise<boolean> {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      const res = await request(`${this.baseUrl}/api/tags`, { method: "GET", signal: ac.signal });
      clearTimeout(t);
      return res.statusCode >= 200 && res.statusCode < 300;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const res = await request(`${this.baseUrl}/api/tags`, { method: "GET" });
    if (res.statusCode !== 200) {
      throw new CctxError("OLLAMA_UNREACHABLE", `Ollama returned ${res.statusCode} from /api/tags`);
    }
    const body = (await res.body.json()) as { models?: Array<{ name: string }> };
    return (body.models ?? []).map((m) => m.name);
  }

  async pull(model: string, onProgress?: (status: string, completed: number, total: number) => void): Promise<void> {
    const res = await request(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
    });
    if (res.statusCode !== 200) {
      const text = await res.body.text();
      throw new CctxError("OLLAMA_PULL_FAILED", `pull ${model}: HTTP ${res.statusCode} ${text.slice(0, 200)}`);
    }
    for await (const chunk of res.body) {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as { status?: string; completed?: number; total?: number; error?: string };
          if (parsed.error) {
            throw new CctxError("OLLAMA_PULL_FAILED", parsed.error);
          }
          if (onProgress) onProgress(parsed.status ?? "", parsed.completed ?? 0, parsed.total ?? 0);
        } catch (e) {
          if (e instanceof CctxError) throw e;
          // Non-JSON lines (very rare) — skip.
        }
      }
    }
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), opts.timeoutMs ?? 60_000);
    try {
      const res = await request(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: opts.model,
          prompt: opts.prompt,
          system: opts.system,
          stream: false,
          format: opts.format,
          options: {
            temperature: opts.temperature ?? 0.2,
            num_ctx: opts.numCtx ?? 4096,
          },
        }),
        signal: ac.signal,
      });
      if (res.statusCode !== 200) {
        const text = await res.body.text();
        throw new CctxError("OLLAMA_GENERATE_FAILED", `generate ${opts.model}: HTTP ${res.statusCode} ${text.slice(0, 200)}`);
      }
      const body = (await res.body.json()) as {
        response: string;
        total_duration?: number;
        eval_count?: number;
      };
      return {
        response: body.response,
        totalDurationMs: Math.round((body.total_duration ?? 0) / 1e6),
        evalCount: body.eval_count ?? 0,
      };
    } catch (e) {
      if (e instanceof CctxError) throw e;
      if ((e as Error).name === "AbortError") {
        throw new CctxError("OLLAMA_TIMEOUT", `Ollama generate timed out after ${opts.timeoutMs ?? 60_000}ms`);
      }
      throw new CctxError("OLLAMA_UNREACHABLE", `Ollama generate failed: ${(e as Error).message}`, { cause: e });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function clientFromConfig(port: number): OllamaClient {
  return new OllamaClient(`http://127.0.0.1:${port}`);
}
