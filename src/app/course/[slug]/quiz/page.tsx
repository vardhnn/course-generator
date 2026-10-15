import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCourseBySlug, getAssessments, getPriorAttempts } from "@/lib/courses";
import { grade } from "@/lib/grading";
import { QUESTION_KINDS, type QuestionKind } from "@/lib/validation";
import { QuizRunner, type QuizQuestion, type QuizInitial } from "@/components/quiz-runner";
import { TutorDock } from "@/components/tutor-dock";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assessments" };

export default async function QuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();

  const [rows, prior] = await Promise.all([
    getAssessments(course.id),
    getPriorAttempts(course.id),
  ]);
  const priorById = new Map(prior.map((a) => [a.assessmentId, a]));

  const questions: QuizQuestion[] = [];
  const initial: QuizInitial[] = [];

  for (const q of rows) {
    let options: string[] = [];
    try {
      const parsed = JSON.parse(q.optionsJson);
      if (Array.isArray(parsed)) options = parsed.map(String);
    } catch {
      options = [];
    }

    questions.push({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      options,
      difficulty: q.difficulty,
      points: q.points,
      moduleTitle: q.moduleTitle,
    });

    // Hydrate from the stored answer so a refresh resumes exactly where the
    // learner left off. Feedback is re-derived by re-grading the response
    // against the same question — grading is deterministic, so the result
    // matches what was shown before, explanation included.
    const saved = priorById.get(q.id);
    if (!saved) continue;
    const kind = (QUESTION_KINDS as readonly string[]).includes(q.kind)
      ? (q.kind as QuestionKind)
      : "mcq";
    const result = grade({
      kind,
      answer: q.answer,
      options,
      response: saved.response,
      points: q.points,
    });
    initial.push({
      id: q.id,
      response: saved.response,
      attempts: saved.attempts,
      outcome: {
        correct: result.correct,
        score: result.score,
        feedback: result.feedback,
        explanation: q.explanation,
      },
    });
  }

  return (
    <div className="flex flex-col gap-6 py-8">
      <header className="rise">
        <nav className="flex flex-wrap items-center gap-2 text-xs">
          <Link href={`/course/${course.slug}`} className="meta underline-offset-4 hover:underline">
            {course.title}
          </Link>
          <span className="meta" aria-hidden>
            /
          </span>
          <span className="meta">Assessments</span>
        </nav>
        <h1 className="font-display mt-2 text-3xl font-semibold">Check yourself</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-soft">
          {questions.length} questions written from this course&apos;s own lesson text — multiple
          choice, true/false, short answer and coding.
        </p>
      </header>

      {questions.length === 0 ? (
        <section className="panel hatch p-8">
          <p className="meta">No assessments</p>
          <p className="mt-1 text-sm text-ink-soft">
            This course has no questions yet. Regenerate it to produce an assessment set.
          </p>
        </section>
      ) : (
        <QuizRunner questions={questions} initial={initial} />
      )}

      <TutorDock courseId={course.id} courseSlug={course.slug} courseTitle={course.title} />
    </div>
  );
}
