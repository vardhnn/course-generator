import { prisma } from "@/lib/prisma";
import { presetFor } from "@/lib/ai/catalog";
import { z } from "zod";

/**
 * Shared shape and helpers for the account provider API: the create/edit
 * input schema, the key-redacted public summary, and the "list + active"
 * payload that both the collection and per-item routes return.
 */

export const ProviderInputSchema = z.object({
  type: z.string().trim().toLowerCase().refine((t) => presetFor(t) !== undefined, {
    message: "Unsupported provider type",
  }),
  model: z.string().trim().min(1).max(200),
  // Stored as a server secret. For cloud providers this is the API key; for
  // a local server (Ollama, LM Studio) it can be left empty.
  key: z.string().trim().max(4096).optional().default(""),
  // Endpoint for URL-based providers. Defaults to the preset's endpoint when
  // left blank so the old one-key setup still maps onto the new model cleanly.
  baseUrl: z.string().trim().max(4096).optional().default(""),
  // Opt-in activation on create; the first provider is always activated.
  activate: z.boolean().optional().default(false),
});

/** The public shape of a stored provider — the key itself never leaves the server. */
export function providerSummary(row: {
  id: string;
  type: string;
  model: string;
  key: string;
  baseUrl: string;
  active: boolean;
}) {
  return {
    id: row.id,
    type: row.type,
    model: row.model,
    hasKey: row.key.length > 0,
    baseUrl: row.baseUrl,
    active: row.active,
  };
}

/** Every provider for a user plus the one that drives generation right now. */
export async function listFor(userId: string) {
  const rows = await prisma.accountProvider.findMany({
    where: { userId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  // Legacy rows (created before the active flag) are all inactive; the
  // oldest one stands in so an existing setup keeps working. Heal the flag
  // once so the stored state and every consumer agree on what's active.
  let active = rows.find((r) => r.active) ?? rows[0] ?? null;
  if (active && !active.active) {
    await prisma.accountProvider.update({
      where: { id: active.id },
      data: { active: true },
    });
    active = { ...active, active: true };
  }
  const activeId = active?.id ?? null;
  return {
    // Summaries report the *effective* active row, matching what the
    // resolver and the server-rendered page already show.
    providers: rows.map((row) => ({ ...providerSummary(row), active: row.id === activeId })),
    activeId,
  };
}
