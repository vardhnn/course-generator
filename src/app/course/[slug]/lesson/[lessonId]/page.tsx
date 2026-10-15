import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLesson, getAssessments, getDoneLessonIds } from "@/lib/courses";
import { Markdown } from "@/components/markdown";
import { LessonFooter } from "@/components/lesson-footer";
import { LessonOutline } from "@/components/lesson-outline";
import { LessonKeys } from "@/components/lesson-keys";
import { ScrollProgress } from "@/components/scroll-progress";
import { Playground } from "@/components/playground";
import { ProgressBar } from "@/components/progress-bar";
import { TutorDock } from "@/components/tutor-dock";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string; lessonId: string }>;
}) {
  const { slug, lessonId } = await params;
  const lesson = await getLesson(lessonId);
  if (!lesson || lesson.module.course.slug !== slug) notFound();

  const course = lesson.module.course;
  const flat = course.modules
    .slice()
    .sort((a, b) => a.position - b.position)
    .flatMap((m) => m.lessons.map((l) => ({ ...l, moduleTitle: m.title })));

  const index = flat.findIndex((l) => l.id === lessonId);
  const prev = index > 0 ? flat[index - 1] : null;
  const next = index < flat.length - 1 ? flat[index + 1] : null;

  const doneIds = await getDoneLessonIds(course.id);
  const doneCount = flat.filter((l) => doneIds.has(l.id)).length;
  const percent = Math.round((doneCount / flat.length) * 100);
  const isDone = doneIds.has(lessonId);

  // Finishing the final lesson has a real next step when the course has
  // assessments: the quiz, not the course page the learner just came from.
  const assessmentCount = (await getAssessments(course.id)).length;
  const finishHref =
    assessmentCount > 0 ? `/course/${course.slug}/quiz` : `/course/${course.slug}`;

  return (
    <div className="flex flex-col gap-6 py-8 pb-24">
      <ScrollProgress />
      <LessonKeys
        prevHref={prev ? `/course/${course.slug}/lesson/${prev.id}` : null}
        nextHref={next ? `/course/${course.slug}/lesson/${next.id}` : null}
      />

      <nav className="rise flex flex-wrap items-center gap-2 text-xs">
        <Link href={`/course/${course.slug}`} className="meta underline-offset-4 hover:underline">
          {course.title}
        </Link>
        <span className="meta" aria-hidden>
          /
        </span>
        {/* Modules have no page of their own, so this links to the module's
            block on the course page — still an escape hatch out of a long
            module, just with an anchor instead of a route. */}
        <Link
          href={`/course/${course.slug}#module-${lesson.module.position}`}
          className="meta underline-offset-4 hover:underline"
        >
          {lesson.module.title}
        </Link>
        <span className="ml-auto meta tabular-nums">
          Lesson {index + 1} of {flat.length}
        </span>
      </nav>

      {/* The whole curriculum, one expand away — jump to any lesson without
          walking prev/next. Sits above the fold because it is navigation. */}
      <div className="rise">
        <LessonOutline
          courseSlug={course.slug}
          currentId={lessonId}
          lessons={flat.map((l) => ({
            id: l.id,
            title: l.title,
            moduleTitle: l.moduleTitle,
            kind: l.kind,
            done: doneIds.has(l.id),
          }))}
        />
      </div>

      <div className="max-w-md">
        <ProgressBar percent={percent} />
      </div>

      <header className="rise">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip">{lesson.kind === "playground" ? "exercise" : "reading"}</span>
          {isDone && <span className="chip text-ok">completed</span>}
          <span className="chip">{lesson.estMinutes} min</span>
        </div>
        <h1 className="font-display mt-3 text-3xl font-semibold leading-tight">{lesson.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{lesson.summary}</p>
      </header>

      <article className="rise max-w-3xl">
        <Markdown source={lesson.contentMd} />
      </article>

      {lesson.kind === "playground" && lesson.codeStarter && (
        <section className="rise">
          <Playground
            lessonId={lesson.id}
            starter={lesson.codeStarter}
            solution={lesson.codeSolution ?? ""}
          />
        </section>
      )}

      <LessonFooter
        lessonId={lesson.id}
        courseSlug={course.slug}
        isDone={isDone}
        prevHref={prev ? `/course/${course.slug}/lesson/${prev.id}` : null}
        prevLabel={prev?.title ?? null}
        nextHref={next ? `/course/${course.slug}/lesson/${next.id}` : null}
        nextLabel={next?.title ?? null}
        isLast={index === flat.length - 1}
        finishHref={finishHref}
      />

      <TutorDock courseId={course.id} courseSlug={course.slug} courseTitle={course.title} />
    </div>
  );
}