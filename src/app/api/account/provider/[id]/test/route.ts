import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { userFromToken, SESSION_COOKIE } from "@/lib/auth";
import { createProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A test must not hang the button: bound the whole probe, retries included. */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Ping a saved provider with a one-word generation and report whether it
 * answered, in how long, and why not if it didn't — so a bad key or a dead
 * Ollama is discovered in a second instead of after an eight-minute course
 * generation fails.
 *
 * Scoped to the caller's own row (404 otherwise) and the response never
 * contains the stored key — only the message the provider returned.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Sign in to test provider settings" }, { status: 401 });
  }

  const { id } = await params;
  const row = await prisma.accountProvider.findFirst({ where: { id, userId: user.id } });
  if (!row) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const provider = createProvider({
    type: row.type,
    model: row.model,
    key: row.key,
    baseUrl: row.baseUrl,
  });

  const started = Date.now();
  try {
    await provider.generate({
      prompt: "Reply with the single word: ok",
      maxTokens: 8,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - started,
      model: row.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      ok: false,
      latencyMs: Date.now() - started,
      error: message.slice(0, 500),
    });
  }
}
