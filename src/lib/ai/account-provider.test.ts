import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

// Same disposable-database pattern as pipeline.test.ts: never touch dev.db.
const DB_FILE = path.resolve(process.cwd(), "prisma/test.db");

beforeAll(async () => {
  rmSync(DB_FILE, { force: true });
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "ignore",
    // `npx` is a shell shim on Windows and cannot be spawned directly.
    shell: true,
  });
}, 120_000);

afterAll(async () => {
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
  rmSync(DB_FILE, { force: true });
});

async function load() {
  const { prisma } = await import("@/lib/prisma");
  const { createSession } = await import("@/lib/auth");
  const { SESSION_COOKIE } = await import("@/lib/auth");
  const route = await import("@/app/api/account/provider/route");
  const item = await import("@/app/api/account/provider/[id]/route");
  const { resolveProviderForRequest, providerFromResolved, sourceLabel } = await import(
    "@/lib/ai/resolve"
  );
  return { prisma, createSession, SESSION_COOKIE, route, item, resolveProviderForRequest, providerFromResolved, sourceLabel };
}

/** Build a user plus a session cookie, mirroring the real signup flow. */
async function signedInUser(email: string) {
  const { prisma, createSession, SESSION_COOKIE } = await load();
  const user = await prisma.user.create({
    data: { email, name: email.split("@")[0], passwordHash: "x:test-only" },
  });
  const { token } = await createSession(user.id);
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

function req(cookie: string | null, init?: { method?: string; body?: string }) {
  return new NextRequest("http://test.local/api/account/provider", {
    method: init?.method,
    body: init?.body,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
}

async function postConfig(cookie: string, body: unknown) {
  const { route } = await load();
  return route.POST(req(cookie, { method: "POST", body: JSON.stringify(body) }));
}

async function getConfig(cookie: string) {
  const { route } = await load();
  return route.GET(req(cookie));
}

/** PATCH/DELETE against a single provider row. */
async function itemReq(cookie: string | null, id: string, method: string, body?: unknown) {
  const { item } = await load();
  const request = new NextRequest(`http://test.local/api/account/provider/${id}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
  });
  const params = Promise.resolve({ id });
  return method === "PATCH"
    ? item.PATCH(request, { params })
    : item.DELETE(request, { params });
}

interface Listing {
  providers: {
    id: string;
    type: string;
    model: string;
    hasKey: boolean;
    baseUrl: string;
    active: boolean;
  }[];
  activeId: string | null;
}

describe("account provider API", () => {
  it("401s for every verb when signed out", async () => {
    const { route, item } = await load();
    expect((await route.GET(req(null))).status).toBe(401);
    expect(
      (await route.POST(req(null, { method: "POST", body: "{}" }))).status,
    ).toBe(401);
    expect((await route.DELETE(req(null, { method: "DELETE" }))).status).toBe(401);
    // The per-item route is equally closed.
    expect((await itemReq(null, "any", "PATCH", {})).status).toBe(401);
    expect((await itemReq(null, "any", "DELETE")).status).toBe(401);
  });

  it("stores and reads back the signed-in user's providers without ever exposing the key", async () => {
    const { cookie } = await signedInUser("byok-save@test.local");
    const res = await postConfig(cookie, {
      type: "openai",
      model: "gpt-4o-mini",
      key: "sk-test-123",
      baseUrl: "https://llm.internal/v1",
    });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as { provider: Listing["providers"][number] } & Listing;
    expect(saved.provider).toMatchObject({
      type: "openai",
      model: "gpt-4o-mini",
      hasKey: true,
      baseUrl: "https://llm.internal/v1",
      active: true,
    });
    // The raw key must never appear in an API response.
    expect(JSON.stringify(saved)).not.toContain("sk-test-123");

    const got = (await (await getConfig(cookie)).json()) as Listing;
    expect(got.providers).toHaveLength(1);
    expect(got.activeId).toBe(saved.provider.id);
    expect(JSON.stringify(got)).not.toContain("sk-test-123");
  });

  it("keeps the stored key when a later edit omits it", async () => {
    const { cookie } = await signedInUser("byok-keep@test.local");
    const created = (await (await postConfig(cookie, {
      type: "gemini",
      model: "gemini-2.5-flash",
      key: "g-keep",
    })).json()) as { provider: Listing["providers"][number] } & Listing;

    // The browser never sees the key, so a model-only edit sends an empty one.
    const res = await itemReq(cookie, created.provider.id, "PATCH", {
      model: "gemini-2.0-flash",
      key: "",
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Listing;
    expect(updated.providers[0]).toMatchObject({ model: "gemini-2.0-flash", hasKey: true });

    const { prisma } = await load();
    const row = await prisma.accountProvider.findFirst({ where: { key: "g-keep" } });
    expect(row?.model).toBe("gemini-2.0-flash");
  });

  it("defaults an openai-type config without a base URL to the OpenAI endpoint", async () => {
    const { cookie } = await signedInUser("byok-default@test.local");
    const res = await postConfig(cookie, { type: "openai", model: "gpt-4o", key: "sk-x" });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as { provider: { baseUrl: string } };
    expect(saved.provider.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("accepts every catalog provider and defaults its endpoint", async () => {
    const anthropic = await signedInUser("byok-anthropic@test.local");
    const aRes = await postConfig(anthropic.cookie, {
      type: "anthropic",
      model: "claude-sonnet-4-5",
      key: "sk-ant-test",
    });
    expect(aRes.status).toBe(201);
    const aSaved = (await aRes.json()) as { provider: { baseUrl: string } };
    expect(aSaved.provider.baseUrl).toBe("https://api.anthropic.com/v1");

    const ollama = await signedInUser("byok-ollama@test.local");
    const oRes = await postConfig(ollama.cookie, {
      type: "ollama",
      model: "qwen3.5:9b",
      key: "",
    });
    expect(oRes.status).toBe(201);
    const oSaved = (await oRes.json()) as { provider: { baseUrl: string; hasKey: boolean } };
    expect(oSaved.provider.baseUrl).toBe("http://localhost:11434");
    expect(oSaved.provider.hasKey).toBe(false);
  });

  it("rejects a custom provider without a base URL", async () => {
    const { cookie } = await signedInUser("byok-custom@test.local");
    const res = await postConfig(cookie, { type: "custom", model: "llama3", key: "" });
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported provider type", async () => {
    const { cookie } = await signedInUser("byok-bad@test.local");
    const res = await postConfig(cookie, { type: "skynet", model: "t-1000", key: "k" });
    expect(res.status).toBe(400);
  });

  it("keeps each account's config isolated", async () => {
    const a = await signedInUser("byok-a@test.local");
    const b = await signedInUser("byok-b@test.local");
    await postConfig(a.cookie, { type: "gemini", model: "gemini-2.5-flash", key: "g-a" });

    const gotB = (await (await getConfig(b.cookie)).json()) as Listing;
    expect(gotB.providers).toHaveLength(0);
    expect(gotB.activeId).toBeNull();
  });

  it("clears every provider on collection delete and 404s when nothing is stored", async () => {
    const { cookie } = await signedInUser("byok-clear@test.local");
    await postConfig(cookie, { type: "gemini", model: "gemini-2.5-flash", key: "g" });

    const del = await (await load()).route.DELETE(req(cookie, { method: "DELETE" }));
    expect(del.status).toBe(200);

    const again = (await load()).route.DELETE;
    const del2 = await again(req(cookie, { method: "DELETE" }));
    expect(del2.status).toBe(404);
  });
});

describe("multi-provider management", () => {
  it("saves several providers, activates the first, and switches the active one", async () => {
    const { cookie } = await signedInUser("byok-multi@test.local");

    const first = (await (await postConfig(cookie, {
      type: "ollama",
      model: "qwen3.5:9b",
      key: "",
    })).json()) as { provider: Listing["providers"][number] } & Listing;
    expect(first.provider.active).toBe(true);

    const second = (await (await postConfig(cookie, {
      type: "gemini",
      model: "gemini-2.5-flash",
      key: "g-multi",
    })).json()) as { provider: Listing["providers"][number] } & Listing;
    // Creating does not steal the active slot.
    expect(second.provider.active).toBe(false);
    expect(second.activeId).toBe(first.provider.id);
    expect(second.providers).toHaveLength(2);

    const switched = (await (await itemReq(cookie, second.provider.id, "PATCH", {
      activate: true,
    })).json()) as Listing;
    expect(switched.activeId).toBe(second.provider.id);
    expect(
      switched.providers.find((p) => p.id === first.provider.id)?.active,
    ).toBe(false);
    expect(
      switched.providers.find((p) => p.id === second.provider.id)?.active,
    ).toBe(true);
  });

  it("deleting the active provider promotes the oldest survivor", async () => {
    const { cookie } = await signedInUser("byok-promote@test.local");
    const a = (await (await postConfig(cookie, {
      type: "ollama",
      model: "qwen3.5:9b",
      key: "",
    })).json()) as { provider: Listing["providers"][number] } & Listing;
    const b = (await (await postConfig(cookie, {
      type: "openai",
      model: "gpt-4o-mini",
      key: "sk-y",
    })).json()) as { provider: Listing["providers"][number] } & Listing;
    await itemReq(cookie, b.provider.id, "PATCH", { activate: true });

    const afterDel = (await (await itemReq(cookie, b.provider.id, "DELETE")).json()) as Listing;
    expect(afterDel.providers).toHaveLength(1);
    expect(afterDel.activeId).toBe(a.provider.id);
  });

  it("deleting a provider that does not exist or is not yours 404s", async () => {
    const mine = await signedInUser("byok-owner@test.local");
    const stranger = await signedInUser("byok-stranger@test.local");
    const created = (await (await postConfig(mine.cookie, {
      type: "ollama",
      model: "qwen3.5:9b",
      key: "",
    })).json()) as { provider: Listing["providers"][number] };

    // A valid id under the wrong session is still a 404.
    expect((await itemReq(stranger.cookie, created.provider.id, "DELETE")).status).toBe(404);
    expect((await itemReq(stranger.cookie, created.provider.id, "PATCH", { model: "x" })).status).toBe(404);
    expect((await itemReq(mine.cookie, "does-not-exist", "DELETE")).status).toBe(404);
  });
});

describe("account-first provider resolution", () => {
  it("prefers the account config even when the env asks for mock", async () => {
    // test-setup forces AI_PROVIDER=mock; an account config must still win.
    const { cookie } = await signedInUser("byok-resolve@test.local");
    await postConfig(cookie, {
      type: "openai",
      model: "local-model",
      key: "",
      baseUrl: "http://localhost:11434/v1",
    });

    const { resolveProviderForRequest } = await load();
    const resolved = await resolveProviderForRequest(
      new Request("http://test.local/", { headers: { cookie } }),
    );
    expect(resolved.source).toBe("account");
    expect(resolved.live).toBe(true);
    expect(resolved.name).toBe("openai");
    expect(resolved.config?.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("resolves to whichever provider is currently active", async () => {
    const { cookie } = await signedInUser("byok-active@test.local");
    await postConfig(cookie, {
      type: "ollama",
      model: "qwen3.5:9b",
      key: "",
    });
    const second = (await (await postConfig(cookie, {
      type: "openai",
      model: "gpt-4o-mini",
      key: "sk-act",
      baseUrl: "https://api.openai.com/v1",
    })).json()) as { provider: Listing["providers"][number] };

    const { resolveProviderForRequest } = await load();
    // First provider was auto-activated on create; the second must not steal it.
    const before = await resolveProviderForRequest(
      new Request("http://test.local/", { headers: { cookie } }),
    );
    expect(before.config?.type).toBe("ollama");

    // Switching the active provider changes what generation resolves to.
    const switched = await itemReq(cookie, second.provider.id, "PATCH", {
      activate: true,
    });
    expect(switched.status).toBe(200);
    const after = await resolveProviderForRequest(
      new Request("http://test.local/", { headers: { cookie } }),
    );
    expect(after.config?.type).toBe("openai");
    expect(after.model).toBe("gpt-4o-mini");
  });

  it("falls back to the local generator when the account has no config", async () => {
    const { cookie } = await signedInUser("byok-none@test.local");
    const { resolveProviderForRequest, providerFromResolved } = await load();
    const resolved = await resolveProviderForRequest(
      new Request("http://test.local/", { headers: { cookie } }),
    );
    expect(resolved.source).toBe("local");
    expect(resolved.live).toBe(false);
    expect(providerFromResolved(resolved)).toBeNull();
  });

  it("builds an OpenAI-compatible client from the account config and honours an empty key", async () => {
    const { cookie } = await signedInUser("byok-local@test.local");
    await postConfig(cookie, {
      type: "openai",
      model: "llama3",
      key: "",
      baseUrl: "http://localhost:11434/v1",
    });

    const { resolveProviderForRequest, providerFromResolved } = await load();
    const resolved = await resolveProviderForRequest(
      new Request("http://test.local/", { headers: { cookie } }),
    );
    const provider = providerFromResolved(resolved);
    expect(provider?.name).toBe("openai");

    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "pong" } }] }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", spy);
    try {
      const out = await provider!.generate({ prompt: "ping" });
      expect(out).toBe("pong");
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://localhost:11434/v1/chat/completions");
      // A keyless local server must not receive an Authorization header.
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);

  it("records a readable source label for the generated course", async () => {
    const { cookie } = await signedInUser("byok-label@test.local");
    await postConfig(cookie, { type: "gemini", model: "gemini-2.5-flash", key: "g" });
    const { resolveProviderForRequest, sourceLabel } = await load();
    const resolved = await resolveProviderForRequest(
      new Request("http://test.local/", { headers: { cookie } }),
    );
    expect(sourceLabel(resolved)).toBe("gemini:gemini-2.5-flash");
  });

  it("resolves an ollama config onto the native client", async () => {
    const { cookie } = await signedInUser("byok-ollama-resolve@test.local");
    await postConfig(cookie, { type: "ollama", model: "qwen3.5:9b", key: "" });
    const { resolveProviderForRequest, providerFromResolved } = await load();
    const resolved = await resolveProviderForRequest(
      new Request("http://test.local/", { headers: { cookie } }),
    );
    expect(resolved.live).toBe(true);
    expect(providerFromResolved(resolved)?.name).toBe("ollama");
  });
});

describe("provider connection test endpoint", () => {
  async function testReq(cookie: string | null, id: string) {
    const mod = await import("@/app/api/account/provider/[id]/test/route");
    const request = new NextRequest(`http://test.local/api/account/provider/${id}/test`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
    });
    return mod.POST(request, { params: Promise.resolve({ id }) });
  }

  it("401s when signed out and 404s for another account's row", async () => {
    const { route } = await load();
    const created = (await (await postConfig(
      (await signedInUser("byok-testowner@test.local")).cookie,
      { type: "openai", model: "gpt-4o-mini", key: "sk-secret" },
    )).json()) as { provider: { id: string } };
    const stranger = await signedInUser("byok-teststranger@test.local");

    expect((await testReq(null, created.provider.id)).status).toBe(401);
    expect((await testReq(stranger.cookie, created.provider.id)).status).toBe(404);
    void route;
  });

  it("reports a readable failure and never leaks the stored key", async () => {
    const { cookie } = await signedInUser("byok-testfail@test.local");
    const created = (await (await postConfig(cookie, {
      type: "openai",
      model: "gpt-4o-mini",
      key: "sk-secret-must-not-leak",
      baseUrl: "https://api.openai.com/v1",
    })).json()) as { provider: { id: string } };

    // Simulate a rejected credential: a 401 is non-transient, so the client
    // fails fast instead of burning the retry budget — no real network here.
    const spy = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Incorrect API key provided" } }),
      text: async () => "unauthorized",
    }));
    vi.stubGlobal("fetch", spy);
    try {
      const res = await testReq(cookie, created.provider.id);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; error?: string; latencyMs?: number };
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/401|Incorrect API key/i);
      expect(typeof body.latencyMs).toBe("number");
      // The provider's own message comes back, never the credential.
      expect(JSON.stringify(body)).not.toContain("sk-secret-must-not-leak");
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
