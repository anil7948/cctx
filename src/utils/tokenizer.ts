// Heuristic token estimator. We avoid bundling tiktoken/llama tokenizers because
// they add ~30MB and the only consumers of this number are stats display + budget
// thresholds — both fine with ±15% accuracy. The 4-chars-per-token approximation
// holds within that range for English + code mixes; we adjust slightly downward
// for code because identifiers tokenize more densely than prose.

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  // Code tends to have shorter tokens (operators, identifiers). 3.6 chars/token
  // matches GPT-4 tokenization of mixed code+prose corpora within ~10%.
  return Math.ceil(chars / 3.6);
}

export function estimateTokensJson(value: unknown): number {
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}
