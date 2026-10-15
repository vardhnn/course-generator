import Link from "next/link";
import type { Metadata } from "next";
import { listCourses, getCourseProgress, getQuizStat, isShellCourse } from "@/lib/courses";
import { ProgressBar } from "@/components/progress-bar";
import { formatMinutes } from "@/lib/validation";
import { BackToDashboard } from "@/components/back-to-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Progress" };

export default async function ProgressPage() {
  // Shells have no lessons, so they would always show "Fully complete" —
  // a course only enters this page once there is something to complete.
  const courses = (await listCourses()).filter((c) => !isShellCourse(c));
  const rows = await Promise.all(
    courses.map(async (c) => ({
      course: c,
      progress: await getCourseProgress(c.id),
      quiz: await getQuizStat(c.id),
    })),
  );

  const totals = rows.reduce(
    (acc, r) => ({
      lessonsDone: acc.lessonsDone + r.progress.done,
      lessonsTotal: acc.lessonsTotal + r.progress.total,
      minutesLeft: acc.minutesLeft + r.progress.minutesLeft,
      questions: acc.questions + r.quiz.total,
      answered: acc.answered + r.quiz.answered,
      earned: acc.earned + r.quiz.earned,
      possible: acc.possible + r.quiz.points,
    }),
    { lessonsDone: 0, lessonsTotal: 0, minutesLeft: 0, questions: 0, answered: 0, earned: 0, possible: 0 },
  );

  const overall =
    totals.lessonsTotal === 0 ? 0 : Math.round((totals.lessonsDone / totals.lessonsTotal) * 100);

  return (
    <div className="flex flex-col gap-8 py-8">
      <BackToDashboard />
      <header className="rise">
        <p className="meta">Progress</p>
        <h1 className="font-display mt-1 text-3xl font-semibold">Where you are</h1>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Lessons done", value: `${totals.lessonsDone}/${totals.lessonsTotal}` },
          { label: "Overall", value: `${overall}%` },
          { label: "Remaining", value: formatMinutes(totals.minutesLeft) },
          { label: "Quiz score", value: `${Math.round(totals.earned * 10) / 10} / ${totals.possible}` },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <p className="meta">{s.label}</p>
            <p className="font-display mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </section>

      {rows.length === 0 ? (
        <section className="panel hatch p-8">
          <p className="meta">Nothing tracked yet</p>
          <p className="mt-1 text-sm text-ink-soft">Generate a course and start the first lesson.</p>
          <Link href="/generate" className="btn mt-4">
            Generate a course
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-semibold">Per course</h2>
          <ul className="stagger flex flex-col gap-3">
            {rows.map(({ course, progress, quiz }) => (
              <li key={course.id} className="panel p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/course/${course.slug}`}
                    className="font-display text-lg font-semibold underline-offset-4 hover:underline"
                  >
                    {course.title}
                  </Link>
                  <span className="meta">{course.level}</span>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <ProgressBar
                    percent={progress.percent}
                    label={`Lessons · ${progress.done}/${progress.total}`}
                  />
                  <ProgressBar
                    percent={
                      quiz.total === 0 ? 0 : Math.round((quiz.answered / quiz.total) * 100)
                    }
                    label={`Assessments · ${quiz.answered}/${quiz.total} answered`}
                  />
                </div>

                <p className="meta mt-3">
                  {progress.minutesLeft === 0
                    ? "Fully complete"
                    : `${formatMinutes(progress.minutesLeft)} of material left`}
                  {" · "}
                  {quiz.earned} of {quiz.points} points earned
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}