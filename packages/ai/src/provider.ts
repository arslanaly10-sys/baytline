import Anthropic from "@anthropic-ai/sdk";
import type { ModelId, UsageLine } from "./models";

/**
 * The provider seam. The gateway talks to this interface only, so tests use a fake and a different
 * Claude platform (Bedrock, Vertex, Foundry) can be added as another implementation.
 */
export type ProviderRequest = { model: ModelId; system: string; prompt: string; maxTokens: number; effort: "low" | "medium" | "high" };
export type ProviderResult = { text: string; stopReason: string | null; servedModel: string; usage: UsageLine[]; latencyMs: number };

export interface AiProvider {
  readonly name: string;
  complete(req: ProviderRequest): Promise<ProviderResult>;
  /** Cheap reachability check that spends no tokens. */
  check(): Promise<{ ok: boolean; summary: string }>;
}

/** Fixed failure codes: provider messages can echo request details, so they never reach logs or screens. */
export class ProviderError extends Error {
  constructor(public code: "not_configured" | "auth" | "rate_limited" | "bad_request" | "overloaded" | "unavailable" | "connection" | "timeout" | "unknown") {
    super(code);
  }
}

/** Secret name, as listed in the platform integration catalog (`ai_gateway`). */
export const PROVIDER_SECRET = "AI_PROVIDER_API_KEY";

function mapError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ProviderError("auth");
  if (e instanceof Anthropic.RateLimitError) return new ProviderError("rate_limited");
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) return new ProviderError("bad_request");
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout");
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError("connection");
  if (e instanceof Anthropic.InternalServerError) return new ProviderError(e.status === 529 ? "overloaded" : "unavailable");
  if (e instanceof Anthropic.APIError) return new ProviderError("unknown");
  return new ProviderError("unknown");
}

/** Claude through the Anthropic API, with the official SDK. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    // Retries 408/409/429/5xx and connection errors twice (SDK default); two minutes per attempt.
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async complete(req: ProviderRequest): Promise<ProviderResult> {
    const started = performance.now();
    try {
      const res = await this.client.beta.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        // Thinking stays adaptive (the default). Effort is set explicitly: Opus 5.5 would otherwise use medium.
        output_config: { effort: req.effort },
        // If a safety classifier declines, the API re-runs the request on a fallback model it chooses.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
      const iterations = res.usage.iterations ?? [];
      // Each attempt is priced at the model that ran it (a fallback may be a different model).
      const usage: UsageLine[] = iterations.length
        ? iterations.flatMap((it) =>
            "input_tokens" in it && "output_tokens" in it
              ? [{
                  model: ("model" in it && it.model) || res.model,
                  input: it.input_tokens, output: it.output_tokens,
                  cacheRead: ("cache_read_input_tokens" in it && it.cache_read_input_tokens) || 0,
                  cacheWrite: ("cache_creation_input_tokens" in it && it.cache_creation_input_tokens) || 0,
                }]
              : [])
        : [{
            model: res.model, input: res.usage.input_tokens, output: res.usage.output_tokens,
            cacheRead: res.usage.cache_read_input_tokens ?? 0, cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
          }];
      return { text, stopReason: res.stop_reason, servedModel: res.model, usage, latencyMs: Math.round(performance.now() - started) };
    } catch (e) {
      throw mapError(e);
    }
  }

  async check(): Promise<{ ok: boolean; summary: string }> {
    try {
      // Reads model metadata: confirms the key works without generating any tokens.
      const m = await this.client.models.retrieve("claude-opus-5-5");
      return { ok: true, summary: `Provider answered; ${m.display_name} is available.` };
    } catch (e) {
      const code = mapError(e).code;
      return { ok: false, summary: code === "auth" ? "The provider rejected the API key." : `Provider check failed (${code}).` };
    }
  }
}

/** The configured provider, or null when the key isn't set. Never logs or returns the key. */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const key = env[PROVIDER_SECRET];
  return key ? new AnthropicProvider(key) : null;
}
