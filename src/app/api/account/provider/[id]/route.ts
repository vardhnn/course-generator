import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { userFromToken, SESSION_COOKIE } from "@/lib/auth";
import { presetFor } from "@/lib/ai/catalog";
import { ProviderInputSchema, providerSummary, listFor } from "@/lib/ai/provider-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Editing keeps the stored key when the browser sends an empty one. */
const EditSchema = ProviderInputSchema.partial();

async function ownRow(userId: string, id: string) {
  // Scoped by userId so one account can never touch another's row.
  return prisma.accountProvider.findFirst({ where: { id, userId } });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Sign in to edit provider settings" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await ownRow(user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = EditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid provider config" },
      { status: 400 },
    );
  }

  const { type, model, key, baseUrl, activate } = parsed.data;
  const nextType = type ?? existing.type;
  const preset = presetFor(nextType);
  if (!preset) {
    return NextResponse.json({ error: "Unsupported provider type" }, { status: 400 });
  }
  const nextBaseUrl =
    (baseUrl ?? "").trim() !== ""
      ? baseUrl!.trim()
      : (existing.baseUrl || preset.baseUrl);

  if (preset.id === "custom" && nextBaseUrl.trim() === "") {
    return NextResponse.json(
      { error: "A base URL is required for a custom OpenAI-compatible provider." },
      { status: 400 },
    );
  }

  // An empty/omitted key field means "keep the stored key" — the browser
  // never sees the value, so a model-only edit must not wipe the credential.
  const nextKey = (key ?? "").trim() === "" ? existing.key : key!.trim();

  const updated = await prisma.$transaction(async (tx) => {
    if (activate && !existing.active) {
      await tx.accountProvider.updateMany({
        where: { userId: user.id, active: true },
        data: { active: false },
      });
    }
    return tx.accountProvider.update({
      where: { id: existing.id },
      data: {
        type: nextType,
        model: model ?? existing.model,
        key: nextKey,
        baseUrl: nextBaseUrl,
        ...(activate ? { active: true } : {}),
      },
    });
  });

  const listed = await listFor(user.id);
  return NextResponse.json({ provider: providerSummary(updated), ...listed });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await userFromToken(_request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Sign in to delete provider settings" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await ownRow(user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  await prisma.accountProvider.delete({ where: { id: existing.id } });

  // Deleting the active provider promotes the oldest survivor so generation
  // keeps working instead of silently falling back to the local generator.
  if (existing.active) {
    const next = await prisma.accountProvider.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    if (next) {
      await prisma.accountProvider.update({ where: { id: next.id }, data: { active: true } });
    }
  }

  const listed = await listFor(user.id);
  return NextResponse.json(listed);
}
