import { listTurns } from "../store/turns.js";
import { listSummaries } from "../store/summaries.js";
import type { SummaryJson } from "../store/summaries.js";
import type { TurnRow } from "../store/turns.js";
import { loadConfig } from "../utils/config.js";
import { listSessionKnowledge } from "../store/session-knowledge.js";
import type { SessionKnowledgeRow } from "../store/session-knowledge.js";

function verbatimWindow(turnCount: number, configured: "auto" | number): number {
  if (configured !== "auto") return configured;
  if (turnCount < 10) return 3;
  if (turnCount <= 25) return 2;
  return 1;
}

function renderSummary(turnIndex: number, s: SummaryJson, suppressDecisions: boolean): string {
  const parts: string[] = [`### Turn ${turnIndex}: ${s.topic}`];
  // Suppress decisions when session_knowledge is present — it carries the current
  // truth for all decisions, avoiding contradictions with older per-turn summaries.
  if (!suppressDecisions && s.decisions.length) parts.push(`Decisions: ${s.decisions.join("; ")}`);
  if (s.code_changes.length) {
    const changes = s.code_changes.map((c) => `${c.file} — ${c.change}`).join("; ");
    parts.push(`Code: ${changes}`);
  }
  if (s.symbols.length) parts.push(`Symbols: ${s.symbols.join(", ")}`);
  if (s.errors_resolved.length) parts.push(`Resolved: ${s.errors_resolved.join("; ")}`);
  if (s.open_questions.length) parts.push(`Open: ${s.open_questions.join("; ")}`);
  if (s.context_for_next) parts.push(`Carry forward: ${s.context_for_next}`);
  return parts.join("\n");
}

function renderVerbatim(turn: TurnRow): string {
  return `### Turn ${turn.turn_index} (verbatim)\nUSER: ${turn.prompt}\nASSISTANT: ${turn.response}`;
}

function renderSessionKnowledge(entries: SessionKnowledgeRow[]): string {
  const lines: string[] = ["## Session Knowledge (current truth)\n"];
  for (const e of entries) {
    lines.push(`- [${e.category}] ${e.fact}`);
  }
  return lines.join("\n");
}

export interface OptimizedContext {
  text: string;
  verbatimTurns: number;
  summarizedTurns: number;
}

export function assembleOptimizedContext(sessionId: string, cwd: string = process.cwd()): OptimizedContext {
  const cfg = loadConfig();
  const turns = listTurns(sessionId, cwd);
  const summaries = listSummaries(sessionId, cwd);
  const summaryByTurnId = new Map(summaries.map((s) => [s.turn_id, s.parsed]));
  const sessionKnowledge = listSessionKnowledge(sessionId, cwd);
  const hasKnowledge = sessionKnowledge.length > 0;

  const window = verbatimWindow(turns.length, cfg.context.verbatimTurnsWindow);
  const cutoff = Math.max(0, turns.length - window);

  const summarizedPart: string[] = [];
  for (let i = 0; i < cutoff; i++) {
    const t = turns[i]!;
    const s = summaryByTurnId.get(t.id);
    if (s) {
      summarizedPart.push(renderSummary(t.turn_index, s, hasKnowledge));
    } else {
      // No summary yet — fall back to a one-line raw header so context isn't lost.
      summarizedPart.push(`### Turn ${t.turn_index} (pending summary)\n${t.prompt.slice(0, 200)}`);
    }
  }

  const verbatimPart: string[] = [];
  for (let i = cutoff; i < turns.length; i++) {
    verbatimPart.push(renderVerbatim(turns[i]!));
  }

  const sections: string[] = [];
  // Session knowledge goes first — it is the single source of truth for decisions
  if (hasKnowledge) {
    sections.push(renderSessionKnowledge(sessionKnowledge));
  }
  if (summarizedPart.length) {
    sections.push(`## Prior turns (summarized)\n\n${summarizedPart.join("\n\n")}`);
  }
  if (verbatimPart.length) {
    sections.push(`## Recent turns (verbatim)\n\n${verbatimPart.join("\n\n")}`);
  }

  return {
    text: sections.join("\n\n"),
    verbatimTurns: verbatimPart.length,
    summarizedTurns: summarizedPart.length,
  };
}
