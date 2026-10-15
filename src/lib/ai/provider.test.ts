import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider, extractJson, resolveProvider } from "@/lib/ai/provider";
import { PROVIDER_PRESETS, presetFor } from "@/lib/ai/catalog";

const ENV_KEYS = ["AI_PROVIDER", "GEMINI_API_KEY", "OPENAI_API_KEY", "GEMINI_MODEL", "OPENAI_MODEL"] as const;
let saved: Record<string, string | undefined>;

beforeEachSave();

function beforeEachSave() {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveProvider", () => {
  it("falls back to the local generator with no keys", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.AI_PROVIDER = "auto";
    const r = resolveProvider();
    expect(r.name).toBe("mock");
    expect(r.live).toBe(false);
  });

  it("honours an explicit provider with a matching key", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-open-test";
    process.env.OPENAI_MODEL = "some/model:free";
    const r = resolveProvider();
    expect(r.name).toBe("openai");
    expect(r.live).toBe(true);
    expect(r.detail).toBe("some/model:free");
  });

  it("does not go live when the requested provider has no key", () => {
    process.env.AI_PROVIDER = "gemini";
    delete process.env.GEMINI_API_KEY;
    const r = resolveProvider();
    expect(r.live).toBe(false);
  });

  it("prefers openai under auto when both keys exist", () => {
    process.env.AI_PROVIDER = "auto";
    process.env.OPENAI_API_KEY = "sk-open-test";
    process.env.GEMINI_API_KEY = "g-test";
    expect(resolveProvider().name).toBe("openai");
  });

  it("falls back to gemini under auto when only that key exists", () => {
    process.env.AI_PROVIDER = "auto";
    delete process.env.OPENROUTER_API_KEY;
    process.env.GEMINI_API_KEY = "g-test";
    expect(resolveProvider().name).toBe("gemini");
  });

  it("treats a blank key as absent", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "   ";
    expect(resolveProvider().live).toBe(false);
  });

  it("honours an explicit mock request even when keys are present", () => {
    process.env.AI_PROVIDER = "mock";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.GEMINI_API_KEY = "g-test";
    expect(resolveProvider().live).toBe(false);
  });
});

describe("OpenAI-compatible error handling", () => {
  function stub(responses: Array<{ status?: number; body: unknown }>) {
    let i = 0;
    const spy = vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(r.body),
        json: async () => r.body,
      };
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("retries an upstream error returned with HTTP 200 and then succeeds", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-open-test";
    process.env.OPENAI_MODEL = "test/model";
    const spy = stub([
      { body: { error: { message: "Upstream error: Service temporarily overloaded", code: 503 } } },
      { body: { choices: [{ message: { content: "hello" } }] } },
    ]);

    const out = await createProvider().generate({ prompt: "hi" });
    expect(out).toBe("hello");
    expect(spy).toHaveBeenCalledTimes(2);
  }, 30000);

  it("does not retry a non-retryable status", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-open-test";
    process.env.OPENAI_MODEL = "test/model";
    const spy = stub([{ status: 401, body: { error: { message: "No auth" } } }]);

    await expect(createProvider().generate({ prompt: "hi" })).rejects.toThrow(/401/);
    expect(spy).toHaveBeenCalledTimes(1);
  }, 30000);

  it("retries a 429 rate limit instead of failing the generation", async () => {
    // Free shared endpoints answer 429 far more often than 5xx, and give up
    // immediately if the budget is burned on the first response.
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-open-test";
    process.env.OPENAI_MODEL = "test/model";
    const spy = stub([
      { status: 429, body: { error: { message: "Provider returned error" } } },
      { body: { choices: [{ message: { content: "recovered" } }] } },
    ]);

    const out = await createProvider().generate({ prompt: "hi" });
    expect(out).toBe("recovered");
    expect(spy).toHaveBeenCalledTimes(2);
  }, 30000);

  it("waits materially longer for a rate limit than for an overload", async () => {
    // Retrying a "retry shortly" 429 after 700ms just wastes an attempt; the
    // backoff has to actually clear the rate-limit window. Succeeding on the
    // second attempt keeps this to a single wait instead of the whole budget.
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-open-test";
    process.env.OPENAI_MODEL = "test/model";
    stub([
      { status: 429, body: { error: { message: "rate limit" } } },
      { body: { choices: [{ message: { content: "ok" } }] } },
    ]);

    const started = Date.now();
    await createProvider().generate({ prompt: "hi" });
    expect(Date.now() - started).toBeGreaterThan(5000);
  }, 40000);

  it("gives up after the attempt budget", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-open-test";
    process.env.OPENAI_MODEL = "test/model";
    const spy = stub([{ body: { error: { message: "Service temporarily overloaded" } } }]);

    await expect(createProvider().generate({ prompt: "hi" })).rejects.toThrow(/upstream error/i);
    // "overloaded" is a capacity spike, so this burns the full budget on the
    // demand backoff (2.5s + 5s + 10s) before giving up.
    expect(spy).toHaveBeenCalledTimes(4);
  }, 45000);

  it("reports an empty completion instead of returning undefined", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-open-test";
    process.env.OPENAI_MODEL = "test/model";
    stub([{ body: { choices: [{ message: { content: "" }, finish_reason: "stop" }] } }]);

    await expect(createProvider().generate({ prompt: "hi" })).rejects.toThrow(/no content/i);
  }, 30000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("strips a markdown fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("finds JSON embedded in prose", () => {
    expect(extractJson('Sure! Here you go:\n{"a":2}\nHope that helps.')).toBe('{"a":2}');
  });

  it("handles arrays", () => {
    expect(extractJson('noise [1,2,3] trailing')).toBe("[1,2,3]");
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("no json here")).toThrow();
  });

  it("throws on truncated JSON", () => {
    expect(() => extractJson('{"a":1')).toThrow();
  });

  it("skips a bracketed aside that precedes the JSON payload", () => {
    // Observed from Gemini: "[Service A] calls [Service B] ... { ...json... }".
    // Anchoring on the first bracket used to return the aside itself.
    const raw = '[Service A] calls [Service B] first.\n{"summary":"tracing","modules":[]}';
    expect(JSON.parse(extractJson(raw))).toEqual({ summary: "tracing", modules: [] });
  });

  it("keeps braces that appear inside string values", () => {
    const raw = 'prefix {"body":"use { and } in code","n":1} trailing';
    expect(JSON.parse(extractJson(raw))).toEqual({ body: "use { and } in code", n: 1 });
  });

  it("picks the payload over leading prose that merely looks like JSON", () => {
    const raw = 'Draft: [not json] final: {"ok":true}';
    expect(JSON.parse(extractJson(raw))).toEqual({ ok: true });
  });
});

describe("Gemini reasoning parts", () => {
  function stubGemini(candidates: unknown) {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "key-test";
    process.env.GEMINI_MODEL = "gemini-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ candidates }) })),
    );
  }

  it("returns the answer part only, never the chain of thought", async () => {
    // Reasoning models emit the thinking first. Joining every part handed the
    // parser brace-free prose, so a perfectly good answer came back as
    // "response contained no JSON".
    stubGemini([
      {
        content: {
          parts: [
            { text: "Let me plan the modules first, carefully and at length.", thought: true },
            { text: '{"summary":"indexes","modules":[]}', thought: false },
          ],
        },
      },
    ]);

    const out = await createProvider().generate({ prompt: "hi", json: true });
    expect(out).toBe('{"summary":"indexes","modules":[]}');
  });

  it("fails loudly when the model only produced thinking", async () => {
    stubGemini([
      {
        finishReason: "MAX_TOKENS",
        content: { parts: [{ text: "Still reasoning about the schema...", thought: true }] },
      },
    ]);

    await expect(createProvider().generate({ prompt: "hi", json: true })).rejects.toThrow(
      /empty response/i,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

describe("provider catalog", () => {
  it("has unique ids, labels and a protocol for every preset", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROVIDER_PRESETS) {
      expect(p.label).toBeTruthy();
      expect(["gemini", "anthropic", "openai", "ollama"]).toContain(p.protocol);
    }
  });

  it("keeps the legacy ids resolvable so old rows keep working", () => {
    expect(presetFor("gemini")?.protocol).toBe("gemini");
    expect(presetFor("openai")?.protocol).toBe("openai");
    expect(presetFor("openrouter")?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(presetFor("ollama")?.protocol).toBe("ollama");
    expect(presetFor("skynet")).toBeUndefined();
  });
});

describe("Ollama native client", () => {
  function stubOllama(responses: Array<{ status?: number; body: unknown }>) {
    let i = 0;
    const spy = vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(r.body),
        json: async () => r.body,
      };
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("uses /api/chat with thinking disabled and a large context", async () => {
    const spy = stubOllama([
      { body: { message: { content: '{"modules":[]}' }, done_reason: "stop" } },
    ]);

    const provider = createProvider({ type: "ollama", model: "qwen3.5:9b", key: "", baseUrl: "" });
    expect(provider.name).toBe("ollama");
    const out = await provider.generate({ prompt: "hi", json: true });
    expect(out).toBe('{"modules":[]}');

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(String(init.body)) as {
      think: boolean;
      format: string;
      stream: boolean;
      options: { num_ctx: number; temperature: number };
    };
    // Reasoning models burn the whole context thinking unless told not to,
    // and their OpenAI shim ignores both of these fields.
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.options.num_ctx).toBeGreaterThanOrEqual(4096);
  }, 30000);

  it("accepts a base URL that already ends in /v1", async () => {
    const spy = stubOllama([{ body: { message: { content: "pong" }, done_reason: "stop" } }]);
    const provider = createProvider({
      type: "ollama",
      model: "qwen3.5:9b",
      key: "",
      baseUrl: "http://localhost:11434/v1/",
    });
    await provider.generate({ prompt: "ping" });
    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe("http://localhost:11434/api/chat");
  }, 30000);

  it("does not retry a model that Ollama cannot find", async () => {
    // Ollama answers 404 for "model not found"; retrying burns minutes on a
    // request that can never succeed.
    const spy = stubOllama([{ status: 404, body: { error: "model 'ghost' not found" } }]);
    const provider = createProvider({ type: "ollama", model: "ghost", key: "", baseUrl: "" });
    await expect(provider.generate({ prompt: "hi" })).rejects.toThrow(/could not find the model/);
    expect(spy).toHaveBeenCalledTimes(1);
  }, 30000);

  it("fails fast on an empty answer instead of retrying a context overflow", async () => {
    // A local model that ran out of context does the same thing on a retry.
    const spy = stubOllama([{ body: { message: { content: "" }, done_reason: "length" } }]);
    const provider = createProvider({ type: "ollama", model: "qwen3.5:9b", key: "", baseUrl: "" });
    await expect(provider.generate({ prompt: "hi" })).rejects.toThrow(/no content/);
    expect(spy).toHaveBeenCalledTimes(1);
  }, 30000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

describe("Anthropic Messages client", () => {
  function stubAnthropic(responses: Array<{ status?: number; body: unknown }>) {
    let i = 0;
    const spy = vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(r.body),
        json: async () => r.body,
      };
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("calls /messages with the required headers and joins text blocks", async () => {
    const spy = stubAnthropic([
      {
        body: {
          content: [
            { type: "text", text: "hello " },
            { type: "text", text: "there" },
          ],
          stop_reason: "end_turn",
        },
      },
    ]);

    const provider = createProvider({
      type: "anthropic",
      model: "claude-sonnet-4-5",
      key: "sk-ant-test",
      baseUrl: "",
    });
    expect(provider.name).toBe("anthropic");
    const out = await provider.generate({ prompt: "hi", system: "be terse" });
    expect(out).toBe("hello there");

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBeTruthy();
    const body = JSON.parse(String(init.body)) as {
      max_tokens: number;
      system: string;
      messages: unknown[];
    };
    // Anthropic rejects a request without max_tokens.
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.system).toBe("be terse");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  }, 30000);

  it("retries a rate limit and then succeeds", async () => {
    stubAnthropic([
      { status: 429, body: { error: { message: "rate limited" } } },
      { body: { content: [{ type: "text", text: "recovered" }], stop_reason: "end_turn" } },
    ]);
    const provider = createProvider({
      type: "anthropic",
      model: "claude-sonnet-4-5",
      key: "sk-ant-test",
      baseUrl: "",
    });
    await expect(provider.generate({ prompt: "hi" })).resolves.toBe("recovered");
  }, 40000);

  it("does not retry an auth failure", async () => {
    const spy = stubAnthropic([{ status: 401, body: { error: { message: "bad key" } } }]);
    const provider = createProvider({
      type: "anthropic",
      model: "claude-sonnet-4-5",
      key: "sk-ant-wrong",
      baseUrl: "",
    });
    await expect(provider.generate({ prompt: "hi" })).rejects.toThrow(/401/);
    expect(spy).toHaveBeenCalledTimes(1);
  }, 30000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});