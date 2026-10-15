import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { viewerScope } from "@/lib/courses";
import { tutorAnswer } from "@/lib/tutor";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let body: { courseId?: string; question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const courseId = (body.courseId ?? "").trim();
  const question = (body.question ?? "").trim();

  if (!courseId) return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  if (question.length < 3) {
    return NextResponse.json({ error: "Ask a slightly longer question." }, { status: 400 });
  }

  // The tutor only answers about courses the caller can see — someone else's
  // course is a 404, never a content oracle.
  const { userId } = await viewerScope();
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { id: true },
  });
  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const result = await tutorAnswer(courseId, question, request);
  return NextResponse.json(result);
}