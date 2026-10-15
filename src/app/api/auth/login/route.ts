import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, sessionCookie, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

const Schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
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
    return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // One message for both cases, so the endpoint cannot be used to probe emails.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name },
  });
  res.cookies.set(sessionCookie(token, expiresAt));
  return res;
}
