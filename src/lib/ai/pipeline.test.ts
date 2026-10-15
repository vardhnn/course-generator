import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";

// DATABASE_URL points at the disposable embedded PostgreSQL that Vitest's
// globalSetup started; force-reset gives each file a clean schema.
beforeAll(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate"], {
    env: { ...process.env },
    stdio: "ignore",
    // `npx` is a shell shim on Windows and cannot be spawned directly.
    shell: true,
  });
}, 120_000);

afterAll(async () => {
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
});

vi.mock("@/lib/ai/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/resolve")>();
  return {
    ...actual,
    resolveProviderForRequest: async () =>
      actual.resolveProviderForRequest()
        .then((r) => (r.live ? r : { source: "local", live: false, name: "mock", model: "", detail: "Deterministic local generator" }))
        .catch(() => ({ source: "local", live: false, name: "mock", model: "", detail: "Deterministic local generator" })),
  };
});



async function load() {
  const { prisma } = await import("@/lib/prisma");
  const { generateCourse, STAGES } = await import("@/lib/ai/pipeline");
  const { retrieve } = await import("@/lib/tutor");
  return { prisma, generateCourse, STAGES, retrieve };
}

describe("course generation pipeline", () => {
  it("runs every stage in order and records each one", async () => {
    const { prisma, generateCourse, STAGES } = await load();

    const events: Array<{ stage: string; status: string }> = [];
    const result = await generateCourse(
      {
        topic: "Recursion and tail calls",
        level: "intermediate",
        goal: "to read recursive code",
        attachments: [],
      },
      (e) => events.push({ stage: e.stage, status: e.status }),
    );

    const doneOrder = events.filter((e) => e.status === "done").map((e) => e.stage);
    expect(doneOrder).toEqual(STAGES.map((s) => s.id));

    const runs = await prisma.generationRun.findMany({ where: { courseId: result.courseId } });
    expect(runs).toHaveLength(STAGES.length);
    expect(runs.every((r) => r.status === "done")).toBe(true);
  }, 60_000);

  // Regression: a browser that disconnects mid-stream makes the route's
  // enqueue throw. That must not abort the pipeline — the generation still
  // runs to completion in the database instead of leaving the stage row
  // stuck at "running" with the course unpublished.
  it("publishes the course even when the event listener throws", async () => {
    const { prisma, generateCourse, STAGES } = await load();
    const result = await generateCourse(
      { topic: "Disconnected client", level: "beginner", goal: "", attachments: [] },
      () => {
        throw new Error("client stream is gone");
      },
    );

    const course = await prisma.course.findUnique({ where: { id: result.courseId } });
    expect(course?.status).toBe("published");

    const runs = await prisma.generationRun.findMany({ where: { courseId: result.courseId } });
    expect(runs).toHaveLength(STAGES.length);
    expect(runs.every((r) => r.status === "done")).toBe(true);
  }, 60_000);

  it("publishes a course with a full curriculum", async () => {
    const { prisma, generateCourse } = await load();
    const result = await generateCourse({
      topic: "Type theory",
      level: "beginner",
      goal: "",
      attachments: [],
    });

    const course = await prisma.course.findUnique({
      where: { id: result.courseId },
      include: { modules: { include: { lessons: true } }, prerequisites: true, assessments: true },
    });

    expect(course?.status).toBe("published");
    expect(course?.summary).toMatch(/^A beginner course/);
    expect(course!.modules.length).toBeGreaterThanOrEqual(4);

    const lessons = course!.modules.flatMap((m) => m.lessons);
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.every((l) => l.contentMd.length > 0)).toBe(true);

    expect(course!.assessments.length).toBeGreaterThanOrEqual(4);
    expect(course!.prerequisites.length).toBeGreaterThan(0);
  }, 60_000);

  it("persists attachments and builds a lesson around them", async () => {
    const { prisma, generateCourse } = await load();
    const attachment = {
      name: "syllabus.md",
      kind: "text" as const,
      size: 42,
      text: "# Course outline\n- Raft leader election\n- Log replication",
    };
    const result = await generateCourse({
      topic: "Distributed consensus",
      level: "beginner",
      goal: "",
      attachments: [attachment],
    });

    const stored = await prisma.attachment.findMany({
      where: { courseId: result.courseId },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("syllabus.md");
    expect(stored[0].kind).toBe("text");
    expect(stored[0].chars).toBe(attachment.text.length);

    // The local blueprint gives attached materials a dedicated lesson.
    const lessons = await prisma.lesson.findMany({
      where: { module: { courseId: result.courseId } },
    });
    expect(lessons.some((l) => l.title === "The attached materials")).toBe(true);
  }, 60_000);

  it("assigns unique slugs when the same topic is generated twice", async () => {
    const { generateCourse } = await load();
    const brief = {
      topic: "Tail calls",
      level: "beginner" as const,
      goal: "",
      attachments: [],
    };
    const first = await generateCourse(brief);
    const second = await generateCourse(brief);
    expect(first.slug).toBe("tail-calls");
    expect(second.slug).toBe("tail-calls-2");
  }, 90_000);

  it("persists every playground exercise it published", async () => {
    const { prisma, generateCourse } = await load();
    const result = await generateCourse({
      topic: "Shader programming",
      level: "advanced",
      goal: "",
      attachments: [],
    });
    const playgrounds = await prisma.lesson.count({
      where: { module: { courseId: result.courseId }, kind: "playground" },
    });
    expect(playgrounds).toBeGreaterThan(0);
  }, 60_000);
});

describe("tutor retrieval", () => {
  it("returns the lesson paragraph most relevant to the question", async () => {
    const { prisma, generateCourse, retrieve } = await load();
    const result = await generateCourse({
      topic: "Distributed consensus",
      level: "advanced",
      goal: "",
      attachments: [],
    });

    const hits = await retrieve(result.courseId, "why is a silent failure so dangerous?");
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.lessonId).toBeTruthy();
      expect(h.lessonTitle).toBeTruthy();
      expect(h.excerpt.length).toBeGreaterThan(0);
    }

    const course = await prisma.course.findUnique({
      where: { id: result.courseId },
      include: { modules: { include: { lessons: true } } },
    });
    const titles = course!.modules.flatMap((m) => m.lessons).map((l) => l.title);
    expect(hits.some((h) => titles.includes(h.lessonTitle))).toBe(true);
  }, 90_000);

  it("returns nothing rather than inventing an answer when nothing matches", async () => {
    const { generateCourse, retrieve } = await load();
    const result = await generateCourse({
      topic: "Fourier analysis",
      level: "beginner",
      goal: "",
      attachments: [],
    });
    const hits = await retrieve(result.courseId, "zzzz qqqq wwww unrelated gibberish");
    expect(hits).toEqual([]);
  }, 90_000);
});