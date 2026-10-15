import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const scrypt = promisify(scryptCb);

/**
 * Sessions are opaque random tokens stored server-side, so a leaked token can
 * be revoked by deleting one row. Passwords use Node's built-in scrypt, which
 * avoids pulling in a native bcrypt build on Windows.
 */
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  // Lengths differ means the hashes can never match; comparing anyway would throw.
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

/** Resolve the signed-in user from a session cookie, or null. */
export async function userFromToken(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export const SESSION_COOKIE = "rcs_session";

/** The signed-in user for the request being rendered, or null. */
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userFromToken(token);
}

/**
 * Pull the session token out of a raw Cookie header. Browsers separate
 * pairs with "; " or ";", so split on ";" and trim instead of assuming
 * one exact spelling.
 */
export function sessionTokenFromRequest(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * A stand-in Request carrying the session cookie, so provider resolution
 * can read identity exactly the way a route handler would. Server pages
 * only have the cookie value, not a request.
 */
export function requestFromCookie(cookie?: string): Request {
  return new Request("http://localhost", {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

export function sessionCookie(token: string, expiresAt: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}
