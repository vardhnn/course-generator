import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { listCourses, getCourseProgress, isShellCourse } from "@/lib/courses";
import { ProgressBar } from "@/components/progress-bar";
import { GeneratingCard } from "@/components/generating-card";
import { AutoRefresh } from "@/components/auto-refresh";
import { STAGES } from "@/lib/ai/pipeline";
import { currentUser } from "@/lib/auth";
import { formatMinutes, type Level } from "@/lib/validation";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboard" };

function levelChip(level: string) {
  return <span className="chip">{level}</span>;
}

export default async function DashboardPage() {
  const [courses, user] = await Promise.all([listCourses(), currentUser()]);
  const totals = await prisma.lesson.count();
  const questionCount = await prisma.assessment.count();

  const withProgress = await Promise.all(
    courses.map(async (c) => ({ course: c, progress: await getCourseProgress(c.id) })),
  );
  // A shell (a run that never produced lessons) has nothing to open and must
  // not count as a course, pad the stats, or render as a card.
  const real = withProgress.filter((c) => !isShellCourse(c.course));
  const active = real
    .filter((c) => c.progress.percent > 0 && c.progress.percent < 100)
    .sort((a, b) => b.progress.percent - a.progress.percent);
  const nextUp = active[0] ?? real.find((c) => c.progress.percent > 0);

  // A course mid-generation has no lessons yet, so it must not be rendered as
  // a finished card. Pull the real per-stage records for each one.
  //
  // A run whose connection dropped can be left in "generating" forever. Past
  // this window the run is abandoned: stop animating and say so, rather than
  // spinning indefinitely on a job nobody is doing.
  const STALE_AFTER_MS = 10 * 60 * 1000;
  const now = Date.now();
  const generating = withProgress.filter(
    (c) =>
      c.course.status === "generating" &&
      now - new Date(c.course.updatedAt).getTime() < STALE_AFTER_MS,
  );
  const stale = withProgress.filter(
    (c) =>
      c.course.status === "generating" &&
      now - new Date(c.course.updatedAt).getTime() >= STALE_AFTER_MS,
  );
  const finished = real
    .filter((c) => c.course.status !== "generating")
    // The section has no sort control, so state the order it uses instead of
    // leaving the reader to guess why a card moved.
    .sort((a, b) => +new Date(b.course.updatedAt) - +new Date(a.course.updatedAt));

  const generatingCards = await Promise.all(
    [...generating, ...stale].map(async ({ course }, i) => {
      const runs = await prisma.generationRun.findMany({ where: { courseId: course.id } });
      const byStage = new Map(runs.map((r) => [r.stage, r]));
      return {
        id: course.id,
        title: course.title,
        level: course.level,
        stale: i >= generating.length,
        stages: STAGES.map((s) => {
          const run = byStage.get(s.id);
          return {
            stage: s.id,
            label: s.label,
            detail: s.detail,
            status: run?.status ?? "pending",
            progress: run?.progress ?? 0,
            message: run?.message ?? "",
          };
        }),
      };
    }),
  );

  return (
    <div className="flex flex-col gap-8 py-8">
      {/* While a course is mid-generation the cards below advance on their
          own — the user can sit on the dashboard and watch, or navigate away
          and come back to live state. */}
      <AutoRefresh active={generatingCards.some((g) => !g.stale)} />
      <section className="rise">
        <p className="meta">Studio</p>
        <h1 className="font-display mt-1 text-4xl font-semibold leading-tight">
          Describe what you want to learn.
        </h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          The studio researches the topic, scores the sources, works out what you are missing, and
          writes the course — lessons, diagrams, exercises and assessments included.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/generate" className="btn btn-accent">
            Generate a course
          </Link>
          {nextUp?.progress.nextLessonId && (
            <Link
              href={`/course/${nextUp.course.slug}/lesson/${nextUp.progress.nextLessonId}`}
              className="btn"
            >
              Continue · {nextUp.course.title}
            </Link>
          )}
        </div>
      </section>

      {/* Four across from the smallest phone; the labels shrink rather than wrap. */}
      <section className="grid grid-cols-4 gap-2 sm:gap-3">
        {[
          { label: "Courses", value: real.length },
          { label: "Lessons", value: totals },
          { label: "Questions", value: questionCount },
          { label: "In progress", value: active.length },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className="card card-hover flex min-h-[4.5rem] flex-col justify-between p-2 sm:min-h-0 sm:p-4"
            style={{ animationDelay: `${i * 55}ms` }}
          >
            {/* .meta is unlayered and would beat a Tailwind font-size on the same
                element, so the responsive sizing lives on an inner span. */}
            <p className="meta">
              <span className="block text-[9px] leading-[1.15] tracking-[0.02em] sm:text-[0.6875rem] sm:leading-[1.4] sm:tracking-[0.14em]">
                {stat.label}
              </span>
            </p>
            <p className="font-display mt-1 text-2xl leading-none font-semibold tabular-nums sm:text-3xl">
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      {real.length === 0 ? (
        <section className="panel hatch flex flex-col items-start gap-3 p-8">
          <p className="meta">{user ? "Empty studio" : "Sign in to start"}</p>
          <h2 className="font-display text-2xl font-semibold">
            {user ? "Nothing on the desk yet." : "Your studio follows your account."}
          </h2>
          <p className="max-w-lg text-sm text-ink-soft">
            {user
              ? "Start by naming a topic and picking a level. You can watch the generation stages run, then open the course and start the lessons."
              : "Courses, progress, assessments and certificates all live with your account. Sign in — or create one — to open your studio."}
          </p>
          <Link
            href={user ? "/generate" : "/login?mode=signup"}
            className="btn btn-accent mt-1"
          >
            {user ? "Generate your first course" : "Sign in or create an account"}
          </Link>
        </section>
      ) : (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="font-display text-xl font-semibold">Your courses</h2>
              <span className="meta">Recently updated first</span>
            </div>
            <Link href="/library" className="meta underline-offset-4 hover:underline">
              All courses →
            </Link>
          </div>
          {/* items-start stops a tall card from stretching its row-mates, and the
              generating cards take the full width so the stepper has room to
              run left-to-right. */}
            <ul className="stagger grid items-start gap-3 sm:grid-cols-2">
            {generatingCards.map((g) => (
              <li key={g.id} className="sm:col-span-2">
                <GeneratingCard
                  title={g.title}
                  level={g.level}
                  stages={g.stages}
                  stale={g.stale}
                />
              </li>
            ))}
            {finished.slice(0, Math.max(4 - generatingCards.length, 0)).map(({ course, progress }) => (
              <li key={course.id} className="h-full">
                <Link href={`/course/${course.slug}`} className="card card-hover block h-full p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold leading-snug">{course.title}</h3>
                    {levelChip(course.level)}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{course.summary}</p>
                  {/* Two generations of the same topic look identical on this
                      grid — the date is what tells them apart. */}
                  <p className="meta mt-2">
                    Created {formatDate(course.createdAt)}
                  </p>
                  <div className="mt-4">
                    <ProgressBar
                      percent={progress.percent}
                      label={`${progress.done}/${progress.total} lessons · ${formatMinutes(
                        progress.minutesLeft,
                      )} left`}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
