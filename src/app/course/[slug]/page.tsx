import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getCourseBySlug, getCourseProgress, getQuizStat, getDoneLessonIds } from "@/lib/courses";
import { prisma } from "@/lib/prisma";
import { userFromToken, SESSION_COOKIE } from "@/lib/auth";
import { ProgressBar } from "@/components/progress-bar";
import { TutorDock } from "@/components/tutor-dock";
import { SourcesDisclosure } from "@/components/sources-disclosure";
import { CertificateClaim } from "@/components/certificate-claim";
import { formatMinutes } from "@/lib/validation";
import { formatBytes } from "@/lib/format";
import { BackToDashboard } from "@/components/back-to-dashboard";

export const dynamic = "force-dynamic";

const PREREQ_TONE: Record<string, string> = {
  missing: "text-bad",
  teaching: "text-warn",
  covered: "text-ok",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();
  return { title: course.title };
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();

  // Progress reads are scoped to the viewer's account (or the device scope
  // when signed out) — never every row on this machine.
  const [progress, quiz, doneIds, sessionUser] = await Promise.all([
    getCourseProgress(course.id),
    getQuizStat(course.id),
    getDoneLessonIds(course.id),
    userFromToken((await cookies()).get(SESSION_COOKIE)?.value),
  ]);
  const existingCert = sessionUser
    ? await prisma.certificate.findUnique({
        where: { userId_courseId: { userId: sessionUser.id, courseId: course.id } },
        select: { serial: true },
      })
    : null;

  return (
    <div className="flex flex-col gap-8 py-8">
      <BackToDashboard />
      <header className="rise">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip chip-accent">{course.level}</span>
          <span className="chip">{course.modules.length} modules</span>
          <span className="chip">{formatMinutes(course.estMinutes)}</span>
        </div>
        <h1 className="font-display mt-3 text-4xl font-semibold leading-tight">{course.title}</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">{course.summary}</p>

        <div className="mt-5 max-w-md">
          <ProgressBar
            percent={progress.percent}
            label={`${progress.done}/${progress.total} lessons · ${formatMinutes(
              progress.minutesLeft,
            )} left`}
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {progress.nextLessonId ? (
            <Link href={`/course/${course.slug}/lesson/${progress.nextLessonId}`} className="btn btn-accent">
              {progress.done === 0 ? "Start course" : "Continue"}
            </Link>
          ) : (
            <>
              <span className="btn" aria-disabled>
                Course complete
              </span>
              {sessionUser && (
                <CertificateClaim
                  slug={course.slug}
                  initialSerial={existingCert?.serial ?? null}
                />
              )}
            </>
          )}
          <Link href={`/course/${course.slug}/quiz`} className="btn">
            Assessments · {quiz.answered}/{quiz.total}
          </Link>
        </div>
      </header>

      <section>
        <h2 className="font-display mb-3 text-xl font-semibold">Curriculum</h2>
        <ol className="stagger flex flex-col gap-4">
          {course.modules.map((m, mi) => (
            <li key={m.id} id={`module-${m.position}`} className="panel p-0 scroll-mt-20">
              <div className="flex items-baseline justify-between gap-3 border-b-2 border-line px-5 py-3">
                <h3 className="font-display text-lg font-semibold">
                  <span className="meta mr-2">{String(mi + 1).padStart(2, "0")}</span>
                  {m.title}
                </h3>
                <span className="meta">{m.lessons.length} lessons</span>
              </div>
              <p className="px-5 pt-3 text-sm text-ink-soft">{m.summary}</p>
              <ul className="mt-2 px-5 pb-4">
                {m.lessons.map((l) => {
                  const isDone = doneIds.has(l.id);
                  return (
                    <li key={l.id} className="border-b border-line-soft last:border-0">
                      <Link
                        href={`/course/${course.slug}/lesson/${l.id}`}
                        className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-surface-2"
                      >
                        <span
                          aria-hidden
                          className={[
                            "w-4 text-center font-mono text-sm",
                            isDone ? "text-ok" : "text-ink-faint",
                          ].join(" ")}
                        >
                          {isDone ? "●" : l.kind === "playground" ? "▷" : "○"}
                        </span>
                        <span className="flex-1 text-sm">{l.title}</span>
                        <span className="chip">
                          {l.kind === "playground" ? "exercise" : `${l.estMinutes}m`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-display text-lg font-semibold">Prerequisites</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Derived by comparing the topic graph against the learner profile.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {course.prerequisites.map((p) => (
              <li key={p.id} className="border-b border-line-soft pb-3 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{p.title}</span>
                  <span className={`meta ${PREREQ_TONE[p.status] ?? ""}`}>{p.status}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">{p.reason}</p>
              </li>
            ))}
          </ul>
        </section>

        <SourcesDisclosure sources={course.sources} />
      </div>

      {course.attachments.length > 0 && (
        <details className="panel overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] text-ink-soft hover:text-ink">
            <span>
              Attached context{" "}
              <span className="tabular-nums text-ink-faint">
                · {course.attachments.length}
              </span>
            </span>
            <span aria-hidden className="text-base leading-none">
              <span className="[details[open]_&]:hidden">+</span>
              <span className="hidden [details[open]_&]:inline">−</span>
            </span>
          </summary>
          <div className="border-t-2 border-line-soft px-5 py-4">
            <p className="mb-3 text-xs text-ink-soft">
              The course was built around these files — the topics, terms and
              skills named in them are the spine of the curriculum.
            </p>
            <ul className="flex flex-col gap-3">
              {course.attachments.map((a) => (
                <li
                  key={a.id}
                  className="border-b border-line-soft pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{a.name}</span>
                    <span className="meta text-ink-faint">
                      {a.kind} · {formatBytes(a.size)} ·{" "}
                      {a.chars.toLocaleString()} chars
                    </span>
                  </div>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap border border-line-soft bg-surface p-2 font-mono text-xs text-ink-soft">
                    {a.text}
                  </pre>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <TutorDock courseId={course.id} courseSlug={course.slug} courseTitle={course.title} />
    </div>
  );
}