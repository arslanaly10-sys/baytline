/**
 * Claude models the gateway knows how to price. Prices are Anthropic first-party API rates in US dollars
 * per million tokens, which is the same number as micro-dollars per token. Review this table when
 * Anthropic's pricing changes: a model that isn't listed can't be allowed, so nothing runs unpriced.
 */
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const MODELS = {
  "claude-opus-5-5": { label: "Claude Opus 5.5", price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } },
  "claude-haiku-5-5": { label: "Claude Haiku 5.5", price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } },
} as const satisfies Record<string, { label: string; price: ModelPrice }>;

export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];
export const DEFAULT_MODEL: ModelId = "claude-opus-5-5";

export function isModelId(v: unknown): v is ModelId {
  return typeof v === "string" && v in MODELS;
}

/** Fallback models a refused request may be re-run on server-side are priced as the most expensive known model. */
function priceOf(model: string): ModelPrice {
  if (isModelId(model)) return MODELS[model].price;
  return MODELS["claude-opus-5-5"].price;
}

export type UsageLine = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number };

/** Exact cost of what ran, in micro-dollars, rounded up. */
export function costMicro(lines: readonly UsageLine[]): number {
  let total = 0;
  for (const l of lines) {
    const p = priceOf(l.model);
    total += l.input * p.input + l.output * p.output + l.cacheRead * p.cacheRead + l.cacheWrite * p.cacheWrite;
  }
  return Math.ceil(total);
}

/**
 * Worst-case cost reserved before a request runs: the estimated input plus the full output allowance.
 * Input is estimated generously (one token per 3 characters) so a reservation is never too small.
 */
export function estimateCostMicro(model: ModelId, promptChars: number, maxOutputTokens: number): number {
  const p = MODELS[model].price;
  return Math.ceil(Math.ceil(promptChars / 3) * p.input + maxOutputTokens * p.output);
}

export const microToUsd = (micro: number | bigint | string) => Number(micro) / 1_000_000;
export const usdToMicro = (usd: number) => Math.round(usd * 1_000_000);
