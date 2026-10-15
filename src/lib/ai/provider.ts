import { presetFor } from "./catalog";

export type ProviderName = "mock" | "gemini" | "openrouter" | "openai" | "anthropic" | "ollama";

export interface GenerateOpts {
  system?: string;
  prompt: string;
  json?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AIProvider {
  readonly name: ProviderName;
  /** True when real credentials are configured for this provider. */
  readonly live: boolean;
  generate(opts: GenerateOpts): Promise<string>;
  stream(opts: GenerateOpts): AsyncIterable<string>;
}

export class MissingCredentialsError extends Error {
  constructor(readonly provider: ProviderName) {
    super(`No credentials configured for the "${provider}" provider.`);
    this.name = "MissingCredentialsError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface AccountProvider {
  /** Catalog id ("gemini", "anthropic", "ollama", …); free-form for legacy rows. */
  type: string;
  model: string;
  key: string;
  baseUrl: string;
}

const MAX_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 120_000;

/** Combine the caller's signal with our own timeout. */
function withTimeout(signal: AbortSignal | undefined, ms = DEFAULT_TIMEOUT_MS): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * OpenRouter proxies upstream providers and reports their failures with
 * HTTP 200 plus an `error` object in the body, so a status check alone is not
 * enough. Retry transient upstream problems with backoff.
 */
function isTransient(message: string): boolean {
  return /overload|temporarily|rate.?limit|timeout|terminated|econnreset|socket hang up|502|503|504|429/i.test(
    message,
  );
}

/** Free and shared endpoints are rate limited in whole minutes, not milliseconds. */
function isRateLimited(message: string): boolean {
  return /429|rate.?limit/i.test(message);
}

/**
 * Gemini's free tier answers 503 "high demand" while the serving tier is
 * saturated. It clears in seconds, so it needs a real wait but not the
 * minute-scale pause a 429 warrants.
 */
function isSaturated(message: string): boolean {
  return /503|high demand|unavailable|overloaded/i.test(message);
}

/**
 * Back off long enough to matter. A shared free endpoint that answers429
 * "retry shortly" will still be saturated 700ms later, so hammering it just
 * burns the attempt budget; these waits are capped to stay well inside the
 * generation route's maxDuration.
 */
function backoffMs(attempt: number, kind: "rate" | "demand" | "plain"): number {
  const base = kind === "rate" ? 8_000 : kind === "demand" ? 2_500 : 2_000;
  return Math.min(base * 2 ** (attempt - 1), 30_000);
}

async function withRetry<T>(
  label: string,
  fn: (attempt: number) => Promise<T>,
  opts?: { maxAttempts?: number },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? MAX_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = error instanceof ProviderError ? error.retryable : isTransient(message);
      if (!retryable || attempt === maxAttempts) break;
      const wait = backoffMs(
        attempt,
        isRateLimited(message) ? "rate" : isSaturated(message) ? "demand" : "plain",
      );
      console.warn(`[ai] ${label} attempt ${attempt} failed (${message}); retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/* ------------------------------------------------------------------ */
/* Gemini — plain REST, no SDK version drift                          */
/* ------------------------------------------------------------------ */

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;
  constructor(
    private key: string,
    private model: string,
  ) {}
  get live() {
    return true;
  }

  private body(opts: GenerateOpts) {
    return {
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: opts.maxTokens ?? 8192,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    };
  }

  async generate(opts: GenerateOpts): Promise<string> {
    return withRetry("gemini", async () => {
      const res = await fetch(`${GEMINI_ENDPOINT}/${this.model}:generateContent?key=${this.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.body(opts)),
        signal: withTimeout(opts.signal),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(
          `Gemini request failed (${res.status}).`,
          body.slice(0, 400),
          res.status === 429 || res.status >= 500,
        );
      }
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; thought?: boolean }> };
          finishReason?: string;
        }>;
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      // Reasoning models return their chain of thought as extra parts flagged
      // `thought`. Joining those into the answer hands the parser prose that
      // contains no JSON at all, so only the real answer parts are used.
      const answer = parts.filter((p) => p.thought !== true);
      const text = answer.map((p) => p.text ?? "").join("");
      if (!text) {
        const finish = data.candidates?.[0]?.finishReason ?? "unknown";
        console.warn(
          `[gemini] no answer part (finish=${finish}, parts=${parts.length}, ` +
            `thoughts=${parts.filter((p) => p.thought === true).length})`,
        );
        throw new ProviderError("Gemini returned an empty response.");
      }
      return text;
    });
  }

  async *stream(opts: GenerateOpts): AsyncIterable<string> {
    // Gemini streaming is a separate endpoint; the pipeline falls back to
    // generate() when a stage needs streaming semantics.
    yield await this.generate(opts);
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible — OpenAI, OpenRouter, and any OpenAI-compatible     */
/* server including a local-hosted model.                                */
/* ------------------------------------------------------------------ */

class OpenAiCompatibleProvider implements AIProvider {
  readonly name = "openai" as const;
  constructor(
    private baseUrl: string,
    private key: string,
    private model: string,
    private extraHeaders?: Record<string, string>,
  ) {}
  get live() {
    return true;
  }

  private messages(opts: GenerateOpts) {
    return [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user" as const, content: opts.prompt },
    ];
  }

  async generate(opts: GenerateOpts): Promise<string> {
    return withRetry("openai", async () => {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.key.trim() ? { Authorization: `Bearer ${this.key}` } : {}),
          ...this.extraHeaders,
        },
        body: JSON.stringify({
          model: this.model,
          messages: this.messages(opts),
          temperature: 0.4,
          max_tokens: opts.maxTokens ?? 8192,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: withTimeout(opts.signal),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(
          `Provider request failed (${res.status}).`,
          body.slice(0, 400),
          res.status === 429 || res.status >= 500,
        );
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        error?: { message?: string; code?: number };
      };

      if (data.error) {
        const message = data.error.message ?? "unknown upstream error";
        throw new ProviderError(`Provider upstream error: ${message}`, undefined, true);
      }

      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? "";
      if (!text) {
        throw new ProviderError(
          `Provider returned no content (finish_reason=${choice?.finish_reason ?? "unknown"}).`,
          undefined,
          choice?.finish_reason === "length",
        );
      }
      return text;
    });
  }

  async *stream(opts: GenerateOpts): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.key.trim() ? { Authorization: `Bearer ${this.key}` } : {}),
        ...this.extraHeaders,
      },
      body: JSON.stringify({ model: this.model, messages: this.messages(opts), stream: true }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      throw new ProviderError(`Provider stream failed (${res.status}).`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Ignore keep-alive frames.
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ollama — native /api/chat. The OpenAI-compatible shim cannot run    */
/* these models properly: it ignores num_ctx (so a reasoning model runs */
/* out of context mid-thought and answers with finish_reason=length and */
/* empty content) and ignores think:false (so the chain of thought eats */
/* the whole context before any answer tokens).                         */
/* ------------------------------------------------------------------ */

const OLLAMA_DEFAULT_BASE = "http://localhost:11434";

/** Accept "host", "host/v1" and trailing-slash variants. */
function normalizeOllamaBase(baseUrl: string): string {
  return (baseUrl.trim() || OLLAMA_DEFAULT_BASE).replace(/\/+$/, "").replace(/\/v1$/, "");
}

class OllamaProvider implements AIProvider {
  readonly name = "ollama" as const;
  // 8192 was not enough headroom for the per-module writing pass: input
  // plus a verbose JSON reply fills the context and the response is cut
  // mid-JSON, which the pipeline then has to replay in full. 16k leaves
  // room; OLLAMA_NUM_CTX lowers it on small machines.
  private numCtx =
    Number(process.env.OLLAMA_NUM_CTX) > 0 ? Number(process.env.OLLAMA_NUM_CTX) : 16_384;
  constructor(
    private baseUrl: string,
    private model: string,
  ) {}
  get live() {
    return true;
  }

  async generate(opts: GenerateOpts): Promise<string> {
    return withRetry(
      "ollama",
      async () => {
        const res = await fetch(`${normalizeOllamaBase(this.baseUrl)}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            messages: [
              ...(opts.system ? [{ role: "system", content: opts.system }] : []),
              { role: "user", content: opts.prompt },
            ],
            stream: false,
            // Reasoning models (qwen3.5, deepseek-r1, …) otherwise spend the
            // whole context thinking and hand back an empty answer.
            think: false,
            ...(opts.json ? { format: "json" } : {}),
            options: {
              num_ctx: this.numCtx,
              temperature: 0.4,
              ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
            },
          }),
          // Local models on CPU can need minutes for a long JSON payload.
          signal: withTimeout(opts.signal, 300_000),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 404) {
            // Ollama answers 404 for "model not found"; retrying wastes
            // minutes on a request that can never succeed.
            throw new ProviderError(
              `Ollama could not find the model \"${this.model}\".`,
              body.slice(0, 200),
              false,
            );
          }
          throw new ProviderError(
            `Ollama request failed (${res.status}).`,
            body.slice(0, 400),
            res.status === 429 || res.status >= 500,
          );
        }

        const data = (await res.json()) as {
          message?: { content?: string };
          done_reason?: string;
          error?: string;
        };
        if (data.error) {
          throw new ProviderError(`Ollama error: ${data.error}`, undefined, true);
        }

        const text = data.message?.content ?? "";
        if (!text) {
          // A local model that ran out of context will do the same thing on
          // the retry, so fail fast and let the pipeline fall back.
          throw new ProviderError(
            `Ollama returned no content (done_reason=${data.done_reason ?? "unknown"}).`,
            undefined,
            false,
          );
        }
        return text;
      },
      // A local server has no upstream outage to wait out; one retry is
      // enough and keeps a slow machine inside the route's time budget.
      { maxAttempts: 2 },
    );
  }

  async *stream(opts: GenerateOpts): AsyncIterable<string> {
    yield await this.generate(opts);
  }
}

/* ------------------------------------------------------------------ */
/* Anthropic — Messages API, which is not OpenAI-compatible.           */
/* ------------------------------------------------------------------ */

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com/v1";

class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  constructor(
    private baseUrl: string,
    private key: string,
    private model: string,
  ) {}
  get live() {
    return true;
  }

  async generate(opts: GenerateOpts): Promise<string> {
    return withRetry("anthropic", async () => {
      const base = (this.baseUrl.trim() || ANTHROPIC_DEFAULT_BASE).replace(/\/+$/, "");
      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.key,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          // Anthropic requires max_tokens; there is no “use the model default”.
          max_tokens: opts.maxTokens ?? 8192,
          ...(opts.system ? { system: opts.system } : {}),
          messages: [{ role: "user", content: opts.prompt }],
        }),
        signal: withTimeout(opts.signal),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(
          `Anthropic request failed (${res.status}).`,
          body.slice(0, 400),
          res.status === 429 || res.status >= 500,
        );
      }

      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        stop_reason?: string;
      };
      const text = (data.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
      if (!text) {
        throw new ProviderError(
          `Anthropic returned no content (stop_reason=${data.stop_reason ?? "unknown"}).`,
          undefined,
          false,
        );
      }
      return text;
    });
  }

  async *stream(opts: GenerateOpts): AsyncIterable<string> {
    yield await this.generate(opts);
  }
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export interface ResolvedProvider {
  name: ProviderName;
  live: boolean;
  detail: string;
}

/**
 * Legacy env-based resolution kept only so old deployments can keep serving
 * during migration. New flows should use account-driven resolution instead.
 */
export function resolveProvider(): ResolvedProvider {
  const requested = (process.env.AI_PROVIDER ?? "auto").toLowerCase();
  const gemini = process.env.GEMINI_API_KEY?.trim();
  const openrouter = process.env.OPENROUTER_API_KEY?.trim();

  if (requested === "gemini" && gemini) {
    return { name: "gemini", live: true, detail: process.env.GEMINI_MODEL ?? "gemini-2.5-flash" };
  }
  if (requested === "openai" && process.env.OPENAI_API_KEY?.trim()) {
    return {
      name: "openai",
      live: true,
      detail: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    };
  }
  if (requested === "auto") {
    if (process.env.OPENAI_API_KEY?.trim()) {
      return {
        name: "openai",
        live: true,
        detail: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      };
    }
    if (gemini) {
      return { name: "gemini", live: true, detail: process.env.GEMINI_MODEL ?? "gemini-2.5-flash" };
    }
  }
  return {
    name: "mock",
    live: false,
    detail: requested === "mock" ? "Deterministic local generator" : "No API key set",
  };
}

function resolvedOpenAiModel(): string {
  return process.env.OPENAI_MODEL ?? resolvedOpenRouterModel();
}

function resolvedOpenRouterModel(): string {
  return process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";
}

export function createProvider(config?: AccountProvider): AIProvider {
  if (config) {
    const preset = presetFor(config.type);
    // Unknown ids from old rows still work: any type with a base URL is
    // treated as OpenAI-compatible, which covers most self-hosted servers.
    const protocol =
      preset?.protocol ??
      (config.type === "gemini"
        ? "gemini"
        : config.type === "anthropic"
          ? "anthropic"
          : config.type === "ollama"
            ? "ollama"
            : config.baseUrl
              ? "openai"
              : undefined);

    if (protocol === "gemini") {
      return new GeminiProvider(config.key.trim(), config.model);
    }
    if (protocol === "anthropic") {
      return new AnthropicProvider(
        config.baseUrl.trim() || preset?.baseUrl || ANTHROPIC_DEFAULT_BASE,
        config.key.trim(),
        config.model,
      );
    }
    if (protocol === "ollama") {
      return new OllamaProvider(config.baseUrl.trim() || OLLAMA_DEFAULT_BASE, config.model);
    }
    if (protocol === "openai") {
      const isOpenRouter =
        preset?.id === "openrouter" || (!preset && config.baseUrl.includes("openrouter.ai"));
      return new OpenAiCompatibleProvider(
        config.baseUrl.trim() || preset?.baseUrl || "https://api.openai.com/v1",
        config.key.trim(),
        config.model,
        isOpenRouter
          ? {
              "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
              "X-Title": "Retro Course Studio",
            }
          : undefined,
      );
    }
  }

  const resolved = resolveProvider();
  if (resolved.name === "gemini") {
    return new GeminiProvider(process.env.GEMINI_API_KEY!.trim(), resolved.detail);
  }
  if (resolved.name === "openai") {
    return new OpenAiCompatibleProvider(
      "https://api.openai.com/v1",
      process.env.OPENAI_API_KEY!.trim(),
      resolved.detail,
      {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
        "X-Title": "Retro Course Studio",
      },
    );
  }
  throw new MissingCredentialsError("mock");
}

/** Balanced slice from `start` to its matching closer, or null if unbalanced. */
function balancedSlice(body: string, start: number): string | null {
  const opener = body[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    // Braces inside strings (quotes in lesson prose) are not structure.
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Strip markdown fences and tolerate the prose models wrap JSON in.
 *
 * Returns the first candidate that actually parses. Models routinely prefix a
 * reply with bracketed asides ("[Service A] calls [Service B] ... { ...json... }"),
 * so anchoring on the first bracket hands back a fragment that will not parse.
 */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();

  let sawCandidate = false;
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "{" && body[i] !== "[") continue;
    const slice = balancedSlice(body, i);
    if (!slice) continue;
    sawCandidate = true;
    try {
      JSON.parse(slice);
      return slice;
    } catch {
      // Not the payload; keep looking.
    }
  }

  if (sawCandidate) throw new ProviderError("Model response contained truncated JSON.");
  throw new ProviderError("Model response contained no JSON.");
}