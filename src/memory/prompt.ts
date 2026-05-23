import type { SummaryJson } from "../store/summaries.js";
import type { KnowledgeRow } from "../store/project-knowledge.js";
import type { SessionKnowledgeRow } from "../store/session-knowledge.js";

// ── Project knowledge extraction ─────────────────────────────────────────────

export const KNOWLEDGE_EXTRACT_SYSTEM =
  `You are a technical knowledge extractor for a software project. ` +
  `You extract durable facts worth remembering across future coding sessions. ` +
  `You produce strict JSON. Never include commentary outside the JSON object.`;

export function buildKnowledgeExtractionPrompt(
  summaries: SummaryJson[],
  existingKnowledge: KnowledgeRow[],
): string {
  // Build compact summary text — if too large, keep only key fields
  const MAX_CHARS = 5000;
  let summaryText = summaries
    .map((s, i) =>
      `[Turn ${i + 1}] Topic: ${s.topic}\n` +
      (s.decisions.length ? `Decisions: ${s.decisions.join("; ")}\n` : "") +
      (s.context_for_next && s.context_for_next !== "none" ? `Context: ${s.context_for_next}\n` : ""),
    )
    .join("\n");

  if (summaryText.length > MAX_CHARS) {
    // Fallback: topic + context only
    summaryText = summaries
      .map((s, i) => `[Turn ${i + 1}] ${s.topic}. ${s.context_for_next !== "none" ? s.context_for_next : ""}`)
      .join("\n")
      .slice(0, MAX_CHARS);
  }

  const existingList =
    existingKnowledge.length > 0
      ? existingKnowledge.map((k) => `  key="${k.key}": ${k.fact}`).join("\n")
      : "  (none yet)";

  return `From these session summaries, extract facts worth remembering in future sessions.
Focus on: architectural decisions, patterns discovered, recurring bugs, unresolved questions.
Skip: one-time fixes, session-specific debugging steps, ephemeral details.

IMPORTANT: If a fact maps to an existing key below, you MUST use that exact key and set action=UPDATE.
Only use action=ADD with a brand-new key if no existing key covers this concept.
Use action=NOOP to skip facts that are too specific to this session.

Existing knowledge:
${existingList}

Session summaries:
${summaryText}

Example:
{"actions": [{"action": "ADD", "key": "serial-ollama-queue", "fact": "Ollama calls are serialised per session to avoid thermal throttling on local hardware.", "category": "decision", "importance": 4}]}

Respond ONLY with this JSON object — no preamble, no trailing text:
{"actions": [{"action": "ADD|UPDATE|NOOP", "key": "short-slug-no-spaces", "fact": "1-2 sentences under 50 words", "category": "decision|pattern|bug|open_question|context", "importance": 1}]}`;
}

// ── Session knowledge consolidation ──────────────────────────────────────────

export const SESSION_CONSOLIDATE_SYSTEM =
  `You are a session knowledge consolidator for a software development session. ` +
  `You maintain a lean, up-to-date knowledge base by deciding ADD, UPDATE, or NOOP for each new fact. ` +
  `You produce strict JSON. Never include commentary outside the JSON object.`;

export function buildSessionConsolidationPrompt(
  newSummary: SummaryJson,
  existingKnowledge: SessionKnowledgeRow[],
  turnId: number,
): string {
  const existingList =
    existingKnowledge.length > 0
      ? existingKnowledge.map((k) => `  key="${k.key}" [${k.category}]: ${k.fact}`).join("\n")
      : "  (none yet)";

  // Cap code_changes to avoid huge prompts on busy turns
  const summaryText = JSON.stringify(
    {
      topic: newSummary.topic,
      decisions: newSummary.decisions,
      code_changes: newSummary.code_changes.slice(0, 5),
      errors_resolved: newSummary.errors_resolved,
      open_questions: newSummary.open_questions,
      context_for_next: newSummary.context_for_next,
    },
    null,
    2,
  );

  return `A new turn (id=${turnId}) was summarised. Update the session knowledge base.
Do NOT create duplicate entries — if an existing key covers the same concept, use UPDATE with that exact key.
Only ADD with a new key if nothing existing covers this concept.
Use NOOP when the new turn adds nothing durable to the knowledge base.

Existing session knowledge:
${existingList}

New turn summary:
${summaryText}

Example:
{"actions": [{"action": "UPDATE", "key": "serial-ollama-queue", "fact": "Ollama calls are serialised per session to prevent thermal throttling.", "category": "decision"}]}

Respond ONLY with this JSON object — no preamble, no trailing text:
{"actions": [{"action": "ADD|UPDATE|NOOP", "key": "short-slug-no-spaces", "fact": "1-2 sentences under 50 words", "category": "decision|pattern|bug|open_question|context"}]}`;
}
