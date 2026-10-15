import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Award, BadgeCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { userFromToken, SESSION_COOKIE } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { BackToDashboard } from "@/components/back-to-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Certificates" };

export default async function CertificatesPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userFromToken(token);

  const certs = user
    ? await prisma.certificate.findMany({
        where: { userId: user.id },
        orderBy: { issuedAt: "desc" },
        select: { serial: true, courseTitle: true, score: true, lessons: true, issuedAt: true },
      })
    : [];

  return (
    <div className="flex flex-col gap-6 py-8">
      <BackToDashboard />
      <header className="rise">
        <p className="meta">Certificates</p>
        <h1 className="font-display mt-1 text-3xl font-semibold">What you have finished</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-soft">
          One certificate per completed course, issued with the name on your profile when you
          finished the last lesson.
        </p>
      </header>

      {!user ? (
        <section className="panel hatch flex flex-col items-start gap-3 p-8">
          <p className="meta">Sign in required</p>
          <h2 className="font-display text-2xl font-semibold">Certificates follow your account.</h2>
          <p className="max-w-lg text-sm text-ink-soft">
            Sign in to see what you have earned — progress and certificates both follow your
            account, on any device.
          </p>
          <Link href="/login" className="btn btn-accent mt-1">
            Sign in
          </Link>
        </section>
      ) : certs.length === 0 ? (
        <section className="panel hatch flex flex-col items-start gap-3 p-8">
          <p className="meta">Nothing yet</p>
          <h2 className="font-display text-2xl font-semibold">No certificates yet.</h2>
          <p className="max-w-lg text-sm text-ink-soft">
            Finish every lesson of a course and its certificate is issued automatically with your
            name on it.
          </p>
          <Link href="/library" className="btn btn-accent mt-1">
            Pick a course
          </Link>
        </section>
      ) : (
        <ul className="stagger flex flex-col gap-3">
          {certs.map((c) => (
            <li key={c.serial} className="card card-hover p-5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <h2 className="font-display flex items-center gap-2 text-xl font-semibold">
                    <BadgeCheck aria-hidden className="size-5 shrink-0 text-ok" />
                    {c.courseTitle}
                  </h2>
                  <dl className="meta mt-2 flex flex-wrap gap-x-5 gap-y-1">
                    <div className="flex gap-1">
                      <dt>Issued</dt>
                      <dd className="text-ink">{formatDate(c.issuedAt)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Lessons</dt>
                      <dd className="text-ink">{c.lessons}</dd>
                    </div>
                    {c.score > 0 && (
                      <div className="flex gap-1">
                        <dt>Score</dt>
                        <dd className="text-ink">{c.score}%</dd>
                      </div>
                    )}
                    <div className="flex gap-1">
                      <dt>Serial</dt>
                      <dd className="text-ink">{c.serial}</dd>
                    </div>
                  </dl>
                </div>
                <Link href={`/certificate/${c.serial}`} className="btn shrink-0">
                  <Award aria-hidden className="size-4" />
                  View
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
