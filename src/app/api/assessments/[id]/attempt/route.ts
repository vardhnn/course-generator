import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { grade } from "@/lib/grading";
import { MAX_ATTEMPTS, QUESTION_KINDS, type QuestionKind } from "@/lib/validation";
import { sessionTokenFromRequest, userFromToken } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Grade one response and record the attempt. Attempts belong to the
 * signed-in account: without a session there is no owner for the row, so
 * writes are refused rather than landing in a shared pile. Each question
 * allows MAX_ATTEMPTS tries; Clear (DELETE) frees the budget.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) {
    return NextResponse.json({ error: "Sign in to record your answer" }, { status: 401 });
  }

  const { id } = await params;

  let body: { response?: string };
  try {
    body = (await request.json()) as { response?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const response = (body.response ?? "").toString();
  if (!response.trim()) {
    return NextResponse.json({ error: "A response is required" }, { status: 400 });
  }

  const question = await prisma.assessment.findUnique({ where: { id } });
  if (!question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const used = await prisma.attempt.count({
    where: { assessmentId: question.id, userId: user.id },
  });
  if (used >= MAX_ATTEMPTS) {
    return NextResponse.json(
      {
        error: `Attempt limit reached (${MAX_ATTEMPTS}). Clear your answer to try again.`,
        attempts: used,
      },
      { status: 429 },
    );
  }

  const kind = (QUESTION_KINDS as readonly string[]).includes(question.kind)
    ? (question.kind as QuestionKind)
    : "mcq";

  let options: string[] = [];
  try {
    const parsed = JSON.parse(question.optionsJson);
    if (Array.isArray(parsed)) options = parsed.map(String);
  } catch {
    options = [];
  }

  const result = grade({
    kind,
    answer: question.answer,
    options,
    response,
    points: question.points,
  });

  await prisma.attempt.create({
    data: {
      assessmentId: question.id,
      userId: user.id,
      answerJson: JSON.stringify({ response }),
      correct: result.correct,
      score: result.score,
    },
  });

  return NextResponse.json({
    correct: result.correct,
    score: result.score,
    feedback: result.feedback,
    explanation: question.explanation,
    attempts: used + 1,
  });
}

/**
 * Clear a question: delete this account's attempts for it so the score,
 * the answer and the retry budget all reset together.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) {
    return NextResponse.json({ error: "Sign in to clear an answer" }, { status: 401 });
  }

  const { id } = await params;
  const { count } = await prisma.attempt.deleteMany({
    where: { assessmentId: id, userId: user.id },
  });

  return NextResponse.json({ ok: true, cleared: count });
}
