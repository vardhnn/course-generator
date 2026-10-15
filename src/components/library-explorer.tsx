"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ProgressBar } from "@/components/progress-bar";
import { DeleteCourseButton } from "@/components/delete-course-button";
import { formatMinutes } from "@/lib/validation";
import { formatDate } from "@/lib/format";

export interface LibraryCourse {
  id: string;
  slug: string;
  title: string;
  summary: string;
  topic: string;
  level: string;
  status: string;
  estMinutes: number;
  createdAt: string;
  updatedAt: string;
  moduleCount: number;
  lessonCount: number;
  assessmentCount: number;
  progress: { done: number; total: number; percent: number; minutesLeft: number };
}

type SortKey = "recent" | "title" | "progress";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently updated" },
  { key: "title", label: "Title A–Z" },
  { key: "progress", label: "Most progress" },
];

/**
 * The library list with the three controls it needs at 20+ courses: free-text
 * search across title/summary, a sort selector, and level chips. Filtering is
 * pure client state over rows the server already handed over — no round trip
 * per keystroke.
 */
export function LibraryExplorer({ courses }: { courses: LibraryCourse[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [level, setLevel] = useState<string | null>(null);

  const levels = useMemo(
    () => [...new Set(courses.map((c) => c.level))].sort(),
    [courses],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = courses.filter((c) => {
      if (level && c.level !== level) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.topic?.toLowerCase().includes(q)
      );
    });
    rows = [...rows].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "progress") return b.progress.percent - a.progress.percent;
      return +new Date(b.updatedAt) - +new Date(a.updatedAt);
    });
    return rows;
  }, [courses, query, sort, level]);

  return (
    <>
      {/* Controls: search takes the space, sort and level stay compact. */}
      <section className="rise flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            className="input pl-9"
            placeholder="Search titles, summaries, topics…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search courses"
          />
        </div>
        <label className="flex items-center gap-2">
          <span className="meta shrink-0">Sort</span>
          <select
            className="input w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort courses"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {levels.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by level">
            <button
              type="button"
              className={`chip${level === null ? " chip-accent" : ""}`}
              aria-pressed={level === null}
              onClick={() => setLevel(null)}
            >
              All
            </button>
            {levels.map((l) => (
              <button
                key={l}
                type="button"
                className={`chip${level === l ? " chip-accent" : ""}`}
                aria-pressed={level === l}
                onClick={() => setLevel(l)}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </section>

      {visible.length === 0 ? (
        <section className="panel hatch p-8">
          <p className="meta">No matches</p>
          <h2 className="font-display mt-1 text-2xl font-semibold">
            {courses.length === 0 ? "The library is empty." : "Nothing matches that."}
          </h2>
          <p className="mt-1 max-w-md text-sm text-ink-soft">
            {courses.length === 0
              ? "Generate a course and it will appear here with its full curriculum, sources and assessments."
              : "Clear the search or pick a different level."}
          </p>
          {courses.length === 0 ? (
            <Link href="/generate" className="btn mt-4">
              Generate a course
            </Link>
          ) : (
            <button
              type="button"
              className="btn mt-4"
              onClick={() => {
                setQuery("");
                setLevel(null);
              }}
            >
              Clear filters
            </button>
          )}
        </section>
      ) : (
        <ul className="stagger flex flex-col gap-3">
          {visible.map((course) => (
            <li key={course.id} className="card card-hover p-5">
              {/* The delete control is a sibling of the link, never a child:
                  a button inside an anchor is invalid and both are
                  independently tabbable. It shares the header row with the
                  chips so the three read as one control group instead of the
                  button floating over them. */}
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <Link href={`/course/${course.slug}`} className="w-full sm:w-auto sm:min-w-0 sm:flex-1">
                  <h2 className="font-display text-xl font-semibold leading-snug">
                    {course.title}
                  </h2>
                  <p className="mt-1 text-sm text-ink-soft">{course.summary}</p>
                </Link>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="chip">{course.level}</span>
                  <span className="chip">{course.status}</span>
                  {/* A run that never produced lessons would otherwise read as
                      a normal course at 0/0 — say what it is. */}
                  {course.lessonCount === 0 && course.status !== "generating" && (
                    <span className="chip chip-accent">incomplete</span>
                  )}
                  <DeleteCourseButton courseId={course.id} title={course.title} />
                </div>
              </div>

              <div className="mt-4">
                <ProgressBar
                  percent={course.progress.percent}
                  label={`${course.progress.done}/${course.progress.total} lessons`}
                />
              </div>

              <dl className="meta mt-3 flex flex-wrap items-start gap-x-5 gap-y-1">
                <div className="flex gap-1">
                  <dt>Modules</dt>
                  <dd className="text-ink">{course.moduleCount}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Lessons</dt>
                  <dd className="text-ink">{course.lessonCount}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Duration</dt>
                  <dd className="text-ink">{formatMinutes(course.estMinutes)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Questions</dt>
                  <dd className="text-ink">{course.assessmentCount}</dd>
                </div>
                {/* Disambiguates two generations of the same topic — the
                    dashboard shows identical-looking cards side by side. */}
                <div className="flex gap-1">
                  <dt>Created</dt>
                  <dd className="text-ink">{formatDate(course.createdAt)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
