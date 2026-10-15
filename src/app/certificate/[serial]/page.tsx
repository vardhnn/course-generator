import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatDateLong } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Certificate" };

/**
 * A certificate is a printed artefact, so it is styled like one: warm paper,
 * double ink rules, a serial number and a real date. No gradients, no seals —
 * the same minimal language as every other surface in the studio.
 */
export default async function CertificatePage({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  const { serial } = await params;
  const cert = await prisma.certificate.findUnique({
    where: { serial },
    select: {
      serial: true,
      recipient: true,
      courseTitle: true,
      score: true,
      lessons: true,
      issuedAt: true,
      course: { select: { slug: true } },
    },
  });
  if (!cert) notFound();

  const issued = formatDateLong(cert.issuedAt);

  return (
    <div className="flex flex-col items-center py-10">
      <article className="panel rise w-full max-w-2xl p-8 sm:p-12">
        {/* Double rule frames the sheet the way a printed certificate does. */}
        <div className="border-2 border-line px-6 py-8 sm:px-10 sm:py-12">
          <div className="flex items-center justify-between gap-3">
            <p className="meta">Retro Course Studio</p>
            <BadgeCheck aria-hidden className="size-6 text-ok" />
          </div>

          <p className="meta mt-10 text-center">Certificate of completion</p>

          <p className="font-display mt-6 text-center text-2xl leading-tight font-semibold sm:text-3xl">
            {cert.recipient}
          </p>

          {/* The rule between names is the traditional divider. */}
          <div className="mx-auto mt-2 h-px w-40 bg-line" />

          <p className="mt-6 text-center text-sm text-ink-soft">
            has completed every lesson of
          </p>

          <p className="font-display mt-2 text-center text-xl font-semibold sm:text-2xl">
            {cert.courseTitle}
          </p>

          <dl className="meta mt-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <dt>Issued</dt>
              <dd className="mt-0.5 font-mono text-xs text-ink">{issued}</dd>
            </div>
            <div>
              <dt>Lessons</dt>
              <dd className="mt-0.5 font-mono text-xs text-ink">{cert.lessons}</dd>
            </div>
            {cert.score > 0 && (
              <div>
                <dt>Assessment score</dt>
                <dd className="mt-0.5 font-mono text-xs text-ink">{cert.score}%</dd>
              </div>
            )}
            <div>
              <dt>Serial</dt>
              <dd className="mt-0.5 font-mono text-xs text-ink">{cert.serial}</dd>
            </div>
          </dl>
        </div>
      </article>

      <div className="no-print mt-6 flex flex-wrap gap-3">
        <PrintButton />
        <Link href={`/course/${cert.course.slug}`} className="btn">
          Back to the course
        </Link>
        <Link href="/library" className="btn btn-ghost">
          Library
        </Link>
      </div>
      <p className="meta no-print mt-4 max-w-md text-center">
        Verify by serial at /certificate/{cert.serial}
      </p>
    </div>
  );
}
