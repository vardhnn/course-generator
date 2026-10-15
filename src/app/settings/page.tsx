import Link from "next/link";
import type { Metadata } from "next";
import { STAGES } from "@/lib/ai/pipeline";
import { cookies } from "next/headers";
import { SESSION_COOKIE, requestFromCookie, userFromToken } from "@/lib/auth";
import { resolveProviderForRequest, providerDisplayName } from "@/lib/ai/resolve";
import { BackToDashboard } from "@/components/back-to-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userFromToken(cookie);

  const resolved = await resolveProviderForRequest(
    user ? requestFromCookie(cookie) : undefined,
  );

  // providerDisplayName already answers "Deterministic local generator"
  // for the no-provider case, and "account" only resolves when a live
  // configured row exists — no second database round trip needed.
  const providerLabel = providerDisplayName(resolved);

  return (
    <div className="flex flex-col gap-8 py-8">
      <BackToDashboard />
      <header className="rise">
        <p className="meta">Settings</p>
        <h1 className="font-display mt-1 text-3xl font-semibold">How generation is wired</h1>
      </header>

      <section className="panel rise p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="meta">Active provider</p>
            <p className="font-display mt-1 text-2xl font-semibold">{providerLabel}</p>
          </div>
          <span className={resolved.live ? "chip chip-accent" : "chip"}>
            {resolved.live ? "live" : "simulated"}
          </span>
        </div>

        {/* One explanation, chosen by source — the old second paragraph
            repeated it verbatim. */}
        <div className="mt-5 border-l-4 border-line bg-paper-2 p-4">
          <p className="text-sm">
            {resolved.source === "account" ? (
              <>
                Courses are generated with the provider stored on your account, used only for
                courses and tutoring on this studio. The API key never leaves the server.
              </>
            ) : resolved.source === "env" ? (
              <>
                Courses are generated with the provider configured in the environment. This path is
                kept only for backward compatibility while accounts migrate to BYOK.
              </>
            ) : (
              <>
                No provider is configured, so courses are produced by the deterministic local
                generator — identical output for the same topic and level, which keeps the
                interface fully demonstrable offline.
              </>
            )}
          </p>
        </div>

        {user && (
          <div className="mt-5">
            <p className="meta mb-2">Your provider</p>
            <Link href="/account/provider" className="btn btn-accent mt-1">
              {resolved.source === "account" ? "Change provider" : "Configure provider"}
            </Link>
          </div>
        )}

        {!user && (
          <div className="mt-5 border-l-4 border-line bg-paper-2 p-4">
            <p className="text-sm">
              Sign in to configure your own provider. Until then, generation uses the
              deterministic local generator.
            </p>
          </div>
        )}
      </section>

      <section className="panel rise p-5">
        <h2 className="font-display text-xl font-semibold">Pipeline</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Every course runs these stages in order, and each one is recorded against the course.
        </p>
        <ol className="mt-4 flex flex-col gap-3">
          {STAGES.map((stage, i) => (
            <li key={stage.id} className="flex gap-3 border-b border-line-soft pb-3 last:border-0">
              <span className="meta w-6 shrink-0 pt-0.5">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <p className="text-sm font-medium">{stage.label}</p>
                <p className="text-xs text-ink-soft">{stage.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel rise p-5">
        <h2 className="font-display text-xl font-semibold">Safety</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Lesson exercises execute in a Web Worker that is terminated after three seconds, so a
          runaway loop cannot freeze the page. Course generation calls the model from the server
          only — no provider key is ever sent to the browser.
        </p>
      </section>
    </div>
  );
}