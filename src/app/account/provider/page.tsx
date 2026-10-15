import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE, userFromToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProviderConfigClient, type ProviderRow } from "./ProviderConfigClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Provider" };

export default async function AccountProviderPage() {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userFromToken(cookie);

  if (!user) {
    redirect("/login?mode=signup&next=/account/provider");
  }

  const rows = await prisma.accountProvider.findMany({
    where: { userId: user.id },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });

  // Active row first; legacy single-provider accounts (pre-flag) show their
  // oldest row as active so the page looks right before any interaction.
  const activeId = (rows.find((r) => r.active) ?? rows[0])?.id ?? null;

  const providers: ProviderRow[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    model: row.model,
    // Server secret: the client only learns whether a key is stored.
    hasKey: row.key.length > 0,
    baseUrl: row.baseUrl,
    active: row.id === activeId,
  }));

  return (
    <ProviderConfigClient
      user={{ id: user.id, email: user.email, name: user.name }}
      providers={providers}
    />
  );
}
