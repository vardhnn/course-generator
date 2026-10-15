import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { userFromToken, SESSION_COOKIE } from "@/lib/auth";
import { presetFor } from "@/lib/ai/catalog";
import { ProviderInputSchema, providerSummary, listFor } from "@/lib/ai/provider-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Sign in to view provider settings" }, { status: 401 });
  }

  const listed = await listFor(user.id);
  return NextResponse.json(listed, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest) {
  const user = await userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Sign in to change provider settings" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = ProviderInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid provider config" },
      { status: 400 },
    );
  }

  const { type, model, key, baseUrl, activate } = parsed.data;
  const preset = presetFor(type)!;

  if (preset.id === "custom" && baseUrl.trim() === "") {
    return NextResponse.json(
      { error: "A base URL is required for a custom OpenAI-compatible provider." },
      { status: 400 },
    );
  }

  // Pin the endpoint into the stored config so the UI can show it and a
  // migration off the legacy env names maps cleanly onto the new model.
  const resolvedBaseUrl = baseUrl.trim() !== "" ? baseUrl.trim() : preset.baseUrl;

  const existing = await prisma.accountProvider.count({ where: { userId: user.id } });
  // The first provider a user saves is what they obviously intend to use.
  const makeActive = activate || existing === 0;

  const created = await prisma.$transaction(async (tx) => {
    if (makeActive) {
      await tx.accountProvider.updateMany({
        where: { userId: user.id, active: true },
        data: { active: false },
      });
    }
    return tx.accountProvider.create({
      data: {
        userId: user.id,
        type,
        model,
        key: key.trim(),
        baseUrl: resolvedBaseUrl,
        active: makeActive,
      },
    });
  });

  const listed = await listFor(user.id);
  return NextResponse.json({ provider: providerSummary(created), ...listed }, { status: 201 });
}

/** Clears every stored provider ("start over"). Single-row removal lives in [id]/route.ts. */
export async function DELETE(request: NextRequest) {
  const user = await userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Sign in to clear provider settings" }, { status: 401 });
  }

  const existing = await prisma.accountProvider.count({ where: { userId: user.id } });
  if (existing === 0) {
    return NextResponse.json({ error: "No provider config to clear" }, { status: 404 });
  }

  await prisma.accountProvider.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ providers: [], activeId: null }, { status: 200 });
}
