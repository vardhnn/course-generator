import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sessionTokenFromRequest, userFromToken } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Remove a course. Modules, lessons, sources, prerequisites, assessments,
 * progress and generation runs all cascade from Course in the schema, so one
 * delete clears the whole tree. Only the owning account can delete its
 * course; anything else is a 404, so the route never confirms existence.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) {
    return NextResponse.json({ error: "Sign in to delete a course" }, { status: 401 });
  }

  const { id } = await params;

  const course = await prisma.course.findFirst({
    where: { OR: [{ id }, { slug: id }], userId: user.id },
    select: { id: true, slug: true, title: true },
  });

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  await prisma.course.delete({ where: { id: course.id } });

  return NextResponse.json({ deleted: { id: course.id, slug: course.slug, title: course.title } });
}
