import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}
