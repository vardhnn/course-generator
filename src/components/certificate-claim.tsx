"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Award, BadgeCheck } from "lucide-react";

/**
 * Shown on a course whose lessons are all done. The first click issues the
 * certificate (idempotent server-side); after that it is a plain link to the
 * document, so re-visiting never re-issues or errors.
 */
export function CertificateClaim({
  slug,
  initialSerial,
}: {
  slug: string;
  /** Serial if this user already holds the certificate for this course. */
  initialSerial: string | null;
}) {
  const router = useRouter();
  const [serial, setSerial] = useState(initialSerial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        // Not signed in: send them to log in and come straight back.
        router.push(`/login?next=/course/${slug}`);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Could not issue the certificate");
      setSerial(data.certificate.serial as string);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue the certificate");
    } finally {
      setBusy(false);
    }
  }

  if (serial) {
    return (
      <Link href={`/certificate/${serial}`} className="btn btn-accent">
        <BadgeCheck aria-hidden className="size-4" />
        View certificate
      </Link>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={claim} disabled={busy} className="btn btn-accent">
        <Award aria-hidden className="size-4" />
        {busy ? "Issuing…" : "Get certificate"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}
