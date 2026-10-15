import Link from "next/link";
import type { Metadata } from "next";
import { listCourses, getCourseProgress } from "@/lib/courses";
import { LibraryExplorer } from "@/components/library-explorer";
import { BackToDashboard } from "@/components/back-to-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const courses = await listCourses();
  const rows = await Promise.all(
    courses.map(async (c) => {
      const progress = await getCourseProgress(c.id);
      return {
        id: c.id,
        slug: c.slug,
        title: c.title,
        summary: c.summary,
        topic: c.topic,
        level: c.level,
        status: c.status,
        estMinutes: c.estMinutes,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        moduleCount: c.modules.length,
        lessonCount: c.modules.reduce((s, m) => s + m.lessons.length, 0),
        assessmentCount: c._count.assessments,
        progress,
      };
    }),
  );

  return (
    <div className="flex flex-col gap-6 py-8">
      <BackToDashboard />
      <header className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="meta">Library</p>
          <h1 className="font-display mt-1 text-3xl font-semibold">Everything on the desk</h1>
        </div>
        <Link href="/generate" className="btn btn-accent">
          New course
        </Link>
      </header>

      <LibraryExplorer courses={rows} />
    </div>
  );
}
