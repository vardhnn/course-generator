import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getQuizStat } from "@/lib/courses";
import { userFromToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Issue a certificate for a completed course. One per user per course: the
 * recipient name is frozen at issue time so a later profile edit cannot
 * rewrite what an existing certificate says.
 */
export async function POST(request: NextRequest) {
  const user = await userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Sign in to receive a certificate" }, { status: 401 });
  }

  const { slug } = (await request.json().catch(() => ({}))) as { slug?: string };
  if (!slug) {
    return NextResponse.json({ error: "Missing course slug" }, { status: 400 });
  }

  // Only the owner's course can issue them a certificate.
  const course = await prisma.course.findUnique({
    where: { slug, userId: user.id },
    select: { id: true, title: true, status: true, _count: { select: { modules: true } } },
  });
  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  // Completion is judged from this account's lesson progress, not from the
  // caller's claim — and never from another user's rows on the same device.
  const [total, done] = await Promise.all([
    prisma.lesson.count({ where: { module: { courseId: course.id } } }),
    prisma.progress.count({ where: { courseId: course.id, userId: user.id, status: "done" } }),
  ]);
  if (total === 0 || done < total) {
    return NextResponse.json(
      { error: "Finish every lesson in the course to receive its certificate" },
      { status: 409 },
    );
  }

  // Quiz score at issue time. Attempts are stored per question, so reuse the
  // same latest-attempt rule the quiz page reports.
  const quiz = await getQuizStat(course.id);
  const score = quiz.total === 0 ? 0 : Math.round((quiz.earned / quiz.points) * 100);

  const existing = await prisma.certificate.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
  });
  if (existing) {
    return NextResponse.json({ certificate: existing, issued: false });
  }

  const certificate = await prisma.certificate.create({
    data: {
      serial: `RCS-${randomBytes(4).toString("hex").toUpperCase()}`,
      userId: user.id,
      courseId: course.id,
      recipient: user.name || user.email.split("@")[0],
      courseTitle: course.title,
      score,
      lessons: total,
    },
  });

  return NextResponse.json({ certificate, issued: true }, { status: 201 });
}
