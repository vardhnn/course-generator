import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

const Schema = z.object({
  name: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid details" },
      { status: 400 },
    );
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Do not reveal that the account exists beyond what is needed to act.
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password) },
    select: { id: true, email: true, name: true },
  });

  // Libraries are strictly per-account: a new account starts empty and only
  // ever sees courses it generated itself.
  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json({ user }, { status: 201 });
  res.cookies.set(sessionCookie(token, expiresAt));
  return res;
}
