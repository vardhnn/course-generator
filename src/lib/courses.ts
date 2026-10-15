import "server-only";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";

/**
 * Courses and progress belong to the signed-in account. Signed-out reads see
 * only the device-local rows (userId null) that come from the seed; nothing
 * is ever adopted into an account, so two accounts sharing one machine never
 * see each other's work.
 */
export async function viewerScope(): Promise<{ userId: string | null }> {
  const user = await currentUser();
  return { userId: user?.id ?? null };
}

const scope = viewerScope;

export async function listCourses() {
  const { userId } = await viewerScope();
  return prisma.course.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { modules: { include: { lessons: true } }, _count: { select: { assessments: true } } },
  });
}

export async function getCourseBySlug(slug: string) {
  const { userId } = await viewerScope();
  return prisma.course.findUnique({
    where: { slug, userId },
    include: {
      modules: {
        orderBy: { position: "asc" },
        include: { lessons: { orderBy: { position: "asc" } } },
      },
      sources: true,
      prerequisites: true,
      attachments: { orderBy: { position: "asc" } },
      _count: { select: { assessments: true } },
    },
  });
}

export async function getLesson(lessonId: string) {
  const { userId } = await viewerScope();
  return prisma.lesson.findUnique({
    where: { id: lessonId, module: { course: { userId } } },
    include: {
      module: {
        include: {
          course: {
            include: {
              modules: {
                orderBy: { position: "asc" },
                include: { lessons: { orderBy: { position: "asc" } } },
              },
            },
          },
        },
      },
    },
  });
}

export async function getAssessments(courseId: string) {
  return prisma.assessment.findMany({ where: { courseId }, orderBy: { id: "asc" } });
}

/**
 * A course shell: a run created the row but never produced lessons (failed
 * or abandoned). It must not render as a finished, "fully complete" course.
 */
export function isShellCourse(course: {
  status: string;
  modules: Array<{ lessons: unknown[] }>;
}): boolean {
  return (
    course.status !== "generating" && course.modules.every((m) => m.lessons.length === 0)
  );
}

export type CourseProgress = {
  done: number;
  total: number;
  percent: number;
  minutesLeft: number;
  nextLessonId: string | null;
};

export async function getCourseProgress(courseId: string): Promise<CourseProgress> {
  const { userId } = await scope();
  const [lessons, done] = await Promise.all([
    prisma.lesson.findMany({
      where: { module: { courseId } },
      orderBy: [{ module: { position: "asc" } }, { position: "asc" }],
      include: { module: true },
    }),
    prisma.progress.findMany({ where: { courseId, userId } }),
  ]);
  const doneIds = new Set(done.map((p) => p.lessonId));
  const total = lessons.length;
  const completed = lessons.filter((l) => doneIds.has(l.id));
  const next = lessons.find((l) => !doneIds.has(l.id)) ?? null;
  return {
    done: completed.length,
    total,
    percent: total === 0 ? 0 : Math.round((completed.length / total) * 100),
    minutesLeft: lessons
      .filter((l) => !doneIds.has(l.id))
      .reduce((s, l) => s + l.estMinutes, 0),
    nextLessonId: next?.id ?? null,
  };
}

/** The current viewer's completed lesson ids for a course, for checkmarks. */
export async function getDoneLessonIds(courseId: string): Promise<Set<string>> {
  const { userId } = await scope();
  const rows = await prisma.progress.findMany({
    where: { courseId, userId },
    select: { lessonId: true },
  });
  return new Set(rows.map((r) => r.lessonId));
}

export type QuizStat = {
  total: number;
  answered: number;
  correct: number;
  points: number;
  earned: number;
};

export async function getQuizStat(courseId: string): Promise<QuizStat> {
  const { userId } = await scope();
  const [questions, attempts] = await Promise.all([
    prisma.assessment.findMany({ where: { courseId } }),
    prisma.attempt.findMany({
      where: { assessment: { courseId }, userId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const latest = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) if (!latest.has(a.assessmentId)) latest.set(a.assessmentId, a);
  const answered = latest.size;
  const correct = [...latest.values()].filter((a) => a.correct).length;
  const points = questions.reduce((s, q) => s + q.points, 0);
  const earned = [...latest.values()].reduce((s, a) => s + a.score, 0);
  return { total: questions.length, answered, correct, points, earned };
}

export type PriorAttempt = {
  assessmentId: string;
  response: string;
  correct: boolean;
  attempts: number;
};

/**
 * The viewer's latest attempt per question plus how many tries it took —
 * the quiz hydrates from this so a refresh resumes instead of forgetting,
 * and the sticky score panel starts from real data.
 */
export async function getPriorAttempts(courseId: string): Promise<PriorAttempt[]> {
  const { userId } = await scope();
  const rows = await prisma.attempt.findMany({
    where: { assessment: { courseId }, userId },
    orderBy: { createdAt: "desc" },
  });
  const latest = new Map<string, PriorAttempt>();
  const counts = new Map<string, number>();
  for (const a of rows) {
    counts.set(a.assessmentId, (counts.get(a.assessmentId) ?? 0) + 1);
    if (latest.has(a.assessmentId)) continue;
    let response = "";
    try {
      const parsed = JSON.parse(a.answerJson) as { response?: unknown };
      if (typeof parsed.response === "string") response = parsed.response;
    } catch {
      // An unreadable stored answer hydrates as empty rather than crashing.
    }
    latest.set(a.assessmentId, {
      assessmentId: a.assessmentId,
      response,
      correct: a.correct,
      attempts: 0,
    });
  }
  return [...latest.values()].map((a) => ({
    ...a,
    attempts: counts.get(a.assessmentId) ?? 0,
  }));
}

/** Flatten a course into an ordered lesson list with its global index. */
export function flattenLessons(course: {
  modules: Array<{ id: string; title: string; position: number; lessons: Array<{ id: string; estMinutes: number }> }>;
}): Array<{ id: string; moduleTitle: string; estMinutes: number; index: number; total: number }> {
  const rows = course.modules
    .slice()
    .sort((a, b) => a.position - b.position)
    .flatMap((m) => m.lessons.map((l) => ({ ...l, moduleTitle: m.title })));
  return rows.map((r, i) => ({ ...r, index: i, total: rows.length }));
}
