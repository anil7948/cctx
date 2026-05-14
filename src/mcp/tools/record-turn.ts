import type { ToolDef } from "./index.js";
import { getOrCreateActiveSession } from "../../store/sessions.js";
import { recordTurn } from "../../store/turns.js";
import { queueSummarization } from "../../summarizer/queue.js";
import { estimateTokens } from "../../utils/tokenizer.js";
import { loadConfig } from "../../utils/config.js";

const MAX_CHARS = 200_000;

export const recordTurnTool: ToolDef = {
  name: "record_turn",
  description:
    "Record a completed turn (user prompt + assistant response). Queues an asynchronous local-LLM summarization. Call this at the end of each turn so the next turn can be assembled from compact summaries.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      response: { type: "string" },
      session_id: { type: "string", description: "Optional. Defaults to the active session." },
    },
    required: ["prompt", "response"],
  },
  handler: async (args) => {
    if (typeof args.prompt !== "string") throw new Error("prompt must be a string");
    if (typeof args.response !== "string") throw new Error("response must be a string");
    if (args.prompt.length > MAX_CHARS) throw new Error(`prompt exceeds ${MAX_CHARS} characters`);
    if (args.response.length > MAX_CHARS) throw new Error(`response exceeds ${MAX_CHARS} characters`);

    const prompt = args.prompt;
    const response = args.response;
    const cfg = loadConfig();
    const sessionId = (args.session_id as string | undefined) ?? getOrCreateActiveSession(cfg.model.active).id;
    const tokens = estimateTokens(prompt) + estimateTokens(response);
    const turn = recordTurn({ sessionId, prompt, response, rawTokensEst: tokens });
    // Fire-and-forget — surfaced errors are written to the daemon log.
    queueSummarization(sessionId).catch(() => undefined);
    return { session_id: sessionId, turn_id: turn.id, turn_index: turn.turn_index, raw_tokens: tokens };
  },
};
