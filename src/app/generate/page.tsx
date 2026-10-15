import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, requestFromCookie, userFromToken } from "@/lib/auth";
import { resolveProviderForRequest, providerDisplayName } from "@/lib/ai/resolve";
import { GenerateClient } from "./generate-client";

export const metadata: Metadata = { title: "Generate" };

export const dynamic = "force-dynamic";

/**
 * Server shell for the generate form: it exists to answer one question the
 * client cannot — which provider will actually serve this request — and pass
 * the label down. Resolving it before the form renders means nobody discovers
 * "you are on the deterministic local generator" only after eight minutes.
 */
export default async function GeneratePage() {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userFromToken(cookie);

  // A generated course belongs to an account, so the form itself starts at
  // sign-in — nobody spends eight minutes only to hit a 401 at the end.
  if (!user) redirect("/login?mode=signup&next=/generate");

  const resolved = await resolveProviderForRequest(
    user ? requestFromCookie(cookie) : undefined,
  );

  return <GenerateClient providerLabel={providerDisplayName(resolved)} />;
}
