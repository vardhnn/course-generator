import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sessionTokenFromRequest, userFromToken } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Mark a lesson complete for the signed-in account. Progress is per-user —
 * an anonymous write would have no owner — so a missing session is a 401
 * the client turns into a sign-in redirect.
 */
export async function POST(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) {
    return NextResponse.json({ error: "Sign in to record progress" }, { status: 401 });
  }

  const { lessonId } = await params;

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { module: { select: { courseId: true } } },
  });
  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  const courseId = lesson.module.courseId;
  await prisma.progress.upsert({
    where: { userId_courseId_lessonId: { userId: user.id, courseId, lessonId } },
    create: { userId: user.id, courseId, lessonId, status: "done" },
    update: { status: "done" },
  });

  const done = await prisma.progress.count({ where: { courseId, userId: user.id } });
  const total = await prisma.lesson.count({ where: { module: { courseId } } });

  return NextResponse.json({ ok: true, done, total });
}
