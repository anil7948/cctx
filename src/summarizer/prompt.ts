export const TURN_SUMMARY_SYSTEM = `You are a conversation summarizer for a software development session. \
You produce strict JSON that preserves technical content while discarding pleasantries, \
repetition, and superseded plans. Never include commentary outside the JSON object.`;

export function buildTurnSummaryPrompt(prompt: string, response: string): string {
  return `Summarize the following turn. Preserve function names, file paths, decisions, errors, and open questions. Omit pleasantries and superseded plans.

USER: ${prompt}
ASSISTANT: ${response}

Respond ONLY with this JSON object — no preamble, no trailing text:
{
  "topic": "one sentence describing this turn",
  "decisions": ["concrete decisions or conclusions reached"],
  "code_changes": [{"file": "path", "change": "what changed"}],
  "symbols": ["function names, types, variables that matter going forward"],
  "errors_resolved": ["bugs or errors that were fixed"],
  "open_questions": ["anything unresolved or deferred"],
  "context_for_next": "one sentence the AI should remember"
}`;
}
