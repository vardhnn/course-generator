import { NextResponse, type NextRequest } from "next/server";
import { userFromToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json(
    { user },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
  return res;
}
