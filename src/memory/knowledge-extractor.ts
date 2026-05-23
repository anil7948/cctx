import { ensureDaemon } from "../ollama/manager.js";
import { loadConfig } from "../utils/config.js";
import { log } from "../utils/logger.js";
import { extractFirstJsonObject, unwrapEnvelope } from "../summarizer/json-extract.js";
import { buildKnowledgeExtractionPrompt, KNOWLEDGE_EXTRACT_SYSTEM } from "./prompt.js";
import type { SummaryJson } from "../store/summaries.js";
import type { KnowledgeRow, KnowledgeCategory } from "../store/project-knowledge.js";

const VALID_CATEGORIES: KnowledgeCategory[] = ["decision", "pattern", "bug", "open_question", "context"];
const VALID_ACTIONS = ["ADD", "UPDATE", "NOOP"] as const;
type ActionType = (typeof VALID_ACTIONS)[number];

export interface KnowledgeAction {
  action: ActionType;
  key: string;
  fact: string;
  category: KnowledgeCategory;
  importance: number;
}

function normalizeKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "unknown";
}

function coerceActions(raw: unknown): KnowledgeAction[] {
  let arr: unknown[];
  try {
    arr = unwrapEnvelope(raw);
  } catch {
    return [];
  }
  return arr
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      action: (VALID_ACTIONS as readonly string[]).includes(String(item.action))
        ? (String(item.action) as ActionType)
        : "NOOP",
      key: normalizeKey(item.key),
      fact: String(item.fact ?? "").trim().slice(0, 300),
      category: VALID_CATEGORIES.includes(item.category as KnowledgeCategory)
        ? (item.category as KnowledgeCategory)
        : "context",
      importance: Math.min(5, Math.max(1, Number(item.importance) || 3)),
    }))
    .filter((a) => a.fact.length > 0 && a.key !== "unknown" && a.action !== "NOOP");
}

export async function extractProjectKnowledge(
  summaries: SummaryJson[],
  existingKnowledge: KnowledgeRow[],
  _sessionId: string,
  cwd: string = process.cwd(),
): Promise<KnowledgeAction[]> {
  const cfg = loadConfig(cwd);
  const client = await ensureDaemon();
  const promptText = buildKnowledgeExtractionPrompt(summaries, existingKnowledge);

  const attempts: Array<{ format: "json" | undefined; temperature: number }> = [
    { format: "json", temperature: 0.1 },
    { format: undefined, temperature: 0.2 },
  ];
  let lastErr: unknown;
  for (const a of attempts) {
    try {
      const result = await client.generate({
        model: cfg.model.active,
        prompt: promptText,
        system: KNOWLEDGE_EXTRACT_SYSTEM,
        temperature: a.temperature,
        format: a.format,
        numCtx: 8192,
        numGpu: cfg.hardware.numGpu,
        timeoutMs: 90_000,
      });
      const parsed = extractFirstJsonObject(result.response);
      return coerceActions(parsed);
    } catch (e) {
      lastErr = e;
      log.warn(`extractProjectKnowledge attempt failed: ${(e as Error).message}`);
    }
  }
  throw new Error(`extractProjectKnowledge failed after retries: ${(lastErr as Error)?.message ?? "unknown"}`);
}
