import { ensureDaemon } from "../ollama/manager.js";
import { loadConfig } from "../utils/config.js";
import { log } from "../utils/logger.js";
import { extractFirstJsonObject, unwrapEnvelope } from "../summarizer/json-extract.js";
import { buildSessionConsolidationPrompt, SESSION_CONSOLIDATE_SYSTEM } from "./prompt.js";
import {
  listSessionKnowledge,
  countSessionKnowledge,
  upsertSessionKnowledge,
  deleteSessionKnowledgeEntry,
} from "../store/session-knowledge.js";
import { listSummaries } from "../store/summaries.js";
import type { SummaryJson } from "../store/summaries.js";
import type { KnowledgeCategory } from "../store/project-knowledge.js";

const VALID_CATEGORIES: KnowledgeCategory[] = ["decision", "pattern", "bug", "open_question", "context"];
const VALID_ACTIONS = ["ADD", "UPDATE", "DELETE", "NOOP"] as const;
type ActionType = (typeof VALID_ACTIONS)[number];

interface ConsolidationAction {
  action: ActionType;
  key: string;
  fact: string;
  category: KnowledgeCategory;
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

function coerceActions(raw: unknown): ConsolidationAction[] {
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
    }))
    .filter((a) => a.key !== "unknown" && a.action !== "NOOP");
}

export async function consolidateSessionKnowledge(
  newSummary: SummaryJson,
  sessionId: string,
  turnId: number,
  cwd: string = process.cwd(),
): Promise<void> {
  const cfg = loadConfig(cwd);
  if (!cfg.memory.enabled) return;

  // Skip until we have enough session history to consolidate meaningfully
  const allSummaries = listSummaries(sessionId, cwd);
  if (allSummaries.length < cfg.memory.consolidationMinTurns) return;

  const existing = listSessionKnowledge(sessionId, cwd);

  // Skip trivial turns when knowledge base is empty (avoids wasting an Ollama call)
  if (
    existing.length === 0 &&
    newSummary.decisions.length === 0 &&
    newSummary.code_changes.length === 0 &&
    newSummary.errors_resolved.length === 0
  ) {
    return;
  }

  const client = await ensureDaemon();
  const promptText = buildSessionConsolidationPrompt(newSummary, existing, turnId);

  const attempts: Array<{ format: "json" | undefined; temperature: number }> = [
    { format: "json", temperature: 0.1 },
    { format: undefined, temperature: 0.2 },
  ];
  let actions: ConsolidationAction[] = [];
  let lastErr: unknown;

  for (const a of attempts) {
    try {
      const result = await client.generate({
        model: cfg.model.active,
        prompt: promptText,
        system: SESSION_CONSOLIDATE_SYSTEM,
        temperature: a.temperature,
        format: a.format,
        numCtx: 4096,
        numGpu: cfg.hardware.numGpu,
        timeoutMs: 60_000,
      });
      const parsed = extractFirstJsonObject(result.response);
      actions = coerceActions(parsed);
      break; // success — exit retry loop
    } catch (e) {
      lastErr = e;
      log.warn(`consolidateSessionKnowledge attempt failed: ${(e as Error).message}`);
    }
  }

  if (actions.length === 0) {
    if (lastErr) log.warn(`consolidateSessionKnowledge gave up: ${(lastErr as Error).message}`);
    return;
  }

  const maxKnowledge = cfg.memory.maxSessionKnowledge;

  for (const action of actions) {
    if (action.fact.length === 0) continue;

    if (action.action === "DELETE") {
      deleteSessionKnowledgeEntry(sessionId, action.key, cwd);
      continue;
    }

    // For ADD, enforce the hard cap
    if (action.action === "ADD") {
      const currentCount = countSessionKnowledge(sessionId, cwd);
      if (currentCount >= maxKnowledge) {
        log.warn(
          `Session knowledge cap (${maxKnowledge}) reached — skipping ADD for key "${action.key}"`,
        );
        continue;
      }
    }

    // ADD and UPDATE both go through upsert
    upsertSessionKnowledge(
      {
        sessionId,
        key: action.key,
        fact: action.fact,
        category: action.category,
        sourceTurnIds: [turnId],
      },
      cwd,
    );
  }
}
