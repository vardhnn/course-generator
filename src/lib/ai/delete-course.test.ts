import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

// DATABASE_URL points at the disposable embedded PostgreSQL that Vitest's
// globalSetup started; force-reset gives each file a clean schema.
const SESSION = "test-owner-session";
const OTHER_SESSION = "test-other-session";

beforeAll(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate"], {
    env: { ...process.env },
    stdio: "ignore",
    // `npx` is a shell shim on Windows and cannot be spawned directly.
    shell: true,
  });

  // The route is owner-scoped now, so the suite needs two identities: one
  // that owns the courses and one that must not be able to touch them.
  const { prisma } = await import("@/lib/prisma");
  const owner = await prisma.user.create({
    data: { email: "owner@test.local", passwordHash: "x", name: "Owner" },
  });
  const other = await prisma.user.create({
    data: { email: "other@test.local", passwordHash: "x", name: "Other" },
  });
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.session.create({ data: { token: SESSION, userId: owner.id, expiresAt } });
  await prisma.session.create({ data: { token: OTHER_SESSION, userId: other.id, expiresAt } });
}, 120_000);

afterAll(async () => {
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
});

/** Build a course with one child row of every kind that cascades from Course. */
async function seedCourse(prisma: any, topic: string, ownerEmail?: string) {
  const owner = ownerEmail
    ? await prisma.user.findUnique({ where: { email: ownerEmail } })
    : null;
  const course = await prisma.course.create({
    data: {
      slug: topic,
      title: topic,
      topic,
      level: "beginner",
      status: "published",
      userId: owner?.id ?? null,
    },
  });
  const mod = await prisma.module.create({
    data: { courseId: course.id, title: "M", position: 0 },
  });
  const lesson = await prisma.lesson.create({
    data: { moduleId: mod.id, title: "L", position: 0, contentMd: "body" },
  });
  await prisma.source.create({
    data: { courseId: course.id, title: "S", url: `https://example.test/${topic}`, reliability: 50 },
  });
  await prisma.prerequisite.create({
    data: { courseId: course.id, title: "P", status: "missing" },
  });
  await prisma.assessment.create({
    data: { courseId: course.id, kind: "mcq", prompt: "Q", answer: "A", points: 1 },
  });
  await prisma.progress.create({
    data: { courseId: course.id, lessonId: lesson.id, status: "completed" },
  });
  await prisma.generationRun.create({
    data: { courseId: course.id, stage: "research", status: "done" },
  });
  return course;
}

async function callDelete(id: string, session?: string) {
  const { DELETE } = await import("@/app/api/courses/[id]/route");
  const headers = session ? { cookie: `rcs_session=${session}` } : undefined;
  const res = await DELETE(new Request("http://test/", { headers }), {
    params: Promise.resolve({ id }),
  });
  return res;
}

describe("DELETE /api/courses/[id]", () => {
  it("removes the course and every row that cascades from it", async () => {
    const { prisma } = await import("@/lib/prisma");
    const course = await seedCourse(prisma, "delete-me", "owner@test.local");

    const res = await callDelete(course.id, SESSION);
    expect(res.status).toBe(200);

    // Nothing may survive: an orphaned lesson or source would be invisible in
    // the UI but would resurface as a count on the dashboard.
    expect(await prisma.course.count({ where: { id: course.id } })).toBe(0);
    expect(await prisma.module.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.lesson.count()).toBe(0);
    expect(await prisma.source.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.prerequisite.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.assessment.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.progress.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.generationRun.count({ where: { courseId: course.id } })).toBe(0);
  });

  it("accepts the slug as well as the id", async () => {
    const { prisma } = await import("@/lib/prisma");
    await seedCourse(prisma, "delete-by-slug", "owner@test.local");

    const res = await callDelete("delete-by-slug", SESSION);
    expect(res.status).toBe(200);
    expect(await prisma.course.count({ where: { slug: "delete-by-slug" } })).toBe(0);
  });

  it("404s for an unknown course rather than reporting success", async () => {
    const res = await callDelete("no-such-course", SESSION);
    expect(res.status).toBe(404);
  });

  it("401s without a session", async () => {
    const { prisma } = await import("@/lib/prisma");
    const course = await seedCourse(prisma, "anon-delete", "owner@test.local");

    const res = await callDelete(course.id);
    expect(res.status).toBe(401);
    expect(await prisma.course.count({ where: { id: course.id } })).toBe(1);
  });

  it("404s for another account's course and leaves it intact", async () => {
    const { prisma } = await import("@/lib/prisma");
    const mine = await seedCourse(prisma, "mine", "owner@test.local");
    const theirs = await seedCourse(prisma, "theirs", "other@test.local");

    // Same id, wrong session: must look identical to a missing course.
    const res = await callDelete(theirs.id, SESSION);
    expect(res.status).toBe(404);
    expect(await prisma.course.count({ where: { id: theirs.id } })).toBe(1);
    expect(await prisma.lesson.count({ where: { module: { courseId: theirs.id } } })).toBe(1);
    // And the owner's own delete still works.
    expect((await callDelete(mine.id, SESSION)).status).toBe(200);
  });

  it("leaves other courses untouched", async () => {
    const { prisma } = await import("@/lib/prisma");
    const keep = await seedCourse(prisma, "keep-me", "owner@test.local");
    const drop = await seedCourse(prisma, "drop-me", "owner@test.local");

    await callDelete(drop.id, SESSION);

    expect(await prisma.course.count({ where: { id: keep.id } })).toBe(1);
    expect(await prisma.lesson.count({ where: { module: { courseId: keep.id } } })).toBe(1);
  });
});
