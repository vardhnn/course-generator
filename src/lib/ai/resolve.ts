import { createProvider, type AccountProvider, type AIProvider } from "./provider";
import { prisma } from "@/lib/prisma";
import { userFromToken, sessionTokenFromRequest } from "@/lib/auth";
import { resolveProvider } from "./provider";
import { presetFor } from "./catalog";

export type { AccountProvider } from "./provider";

export interface ResolvedProvider {
  source: "account" | "env" | "local";
  live: boolean;
  name: "gemini" | "openrouter" | "openai" | "anthropic" | "ollama" | "mock";
  model: string;
  detail: string;
  /** Present only for account-driven configs; env configs read their own key. */
  config?: AccountProvider;
}

export async function resolveAccountProvider(request?: Request): Promise<ResolvedProvider | null> {
  const user = request ? await userFromToken(sessionTokenFromRequest(request)) : null;

  if (!user) return null;

  const rows = await prisma.accountProvider.findMany({
    where: { userId: user.id },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  // Active row first; legacy rows (pre-flag) fall back to the oldest so an
  // existing single-provider setup keeps resolving exactly as before.
  const row = rows.find((r) => r.active) ?? rows[0];
  if (!row) return null;

  const provider = createProvider({
    type: row.type,
    model: row.model,
    key: row.key,
    baseUrl: row.baseUrl,
  });

  return {
    source: "account",
    live: provider.live,
    name: provider.name,
    model: row.model,
    detail: `${row.type}:${row.model}`,
    config: {
      type: row.type,
      model: row.model,
      key: row.key,
      baseUrl: row.baseUrl,
    },
  };
}

export async function resolveProviderForRequest(request?: Request): Promise<ResolvedProvider> {
  const account = await resolveAccountProvider(request);
  if (account && account.live) {
    return account;
  }

  const env = resolveProvider();
  if (env.live) {
    return {
      source: "env",
      live: true,
      name: env.name as "gemini" | "openai" | "mock",
      model: env.detail,
      detail: env.detail,
    };
  }

  return {
    source: "local",
    live: false,
    name: "mock",
    model: "",
    detail: "Deterministic local generator",
  };
}

/** Build the client for a resolved provider, or null when nothing is live. */
export function providerFromResolved(resolved: ResolvedProvider): AIProvider | null {
  if (!resolved.live) return null;
  return createProvider(resolved.config);
}

/**
 * Short provider label recorded against a generated course, e.g.
 * `openai:gpt-4o-mini` for an account config or `openai:model` for an env one.
 */
export function sourceLabel(resolved: ResolvedProvider): string {
  if (resolved.config) return `${resolved.config.type}:${resolved.config.model}`;
  if (resolved.source === "env") return `${resolved.name}:${resolved.model}`;
  return resolved.detail;
}

export function providerDisplayName(resolved: ResolvedProvider): string {
  if (resolved.source === "account") {
    // The stored config knows which vendor this is — the client name alone
    // cannot tell an OpenRouter config from a Groq one.
    const label = presetFor(resolved.config?.type)?.label ?? "Custom provider";
    return `${label} · ${resolved.model}`;
  }

  if (resolved.source === "env") {
    if (resolved.name === "gemini") return `Gemini (env) · ${resolved.model}`;
    if (resolved.name === "openai") return `OpenAI-compatible (env) · ${resolved.model}`;
    return `${resolved.name} (env) · ${resolved.model}`;
  }

  return "Deterministic local generator";
}
