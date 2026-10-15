"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The footer's primary action marks the current lesson complete and then
 * opens the next lesson in one click, so finishing a lesson never strands
 * the learner on a page they have already read. The button sits on the
 * right of the row; prev/next cards below stay for free browsing.
 */
export function LessonFooter({
  lessonId,
  courseSlug,
  isDone,
  prevHref,
  prevLabel,
  nextHref,
  nextLabel,
  isLast,
  finishHref,
}: {
  lessonId: string;
  courseSlug: string;
  isDone: boolean;
  prevHref: string | null;
  prevLabel: string | null;
  nextHref: string | null;
  nextLabel: string | null;
  isLast: boolean;
  /**
   * Where "finish" lands on the final lesson: the assessments when the
   * course has them, otherwise back to the course page. Defaults to the
   * course page so callers without the lookup keep the old behaviour.
   */
  finishHref?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(isDone);
  const [error, setError] = useState<string | null>(null);

  const destination = finishHref ?? `/course/${courseSlug}`;
  const quizBound = Boolean(finishHref && finishHref.endsWith("/quiz"));

  /** Mark this lesson complete, then continue to the next one (or finish). */
  async function completeAndContinue() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (!done) {
        const res = await fetch(`/api/lessons/${lessonId}/complete`, { method: "POST" });
        // Progress is per-account now — an expired or missing session sends
        // the learner to sign in and come straight back here.
        if (res.status === 401) {
          router.push(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Could not mark the lesson complete (${res.status}).`);
        }
        setDone(true);
      }
      // The next lesson — or, on the last one, the assessments/course page.
      // Navigation only after the progress write succeeded, never on failure.
      router.push(nextHref ?? destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
    // On success the route is leaving this page; saving stays true so the
    // button cannot double-submit during the transition.
  }

  const buttonLabel = saving
    ? done
      ? "Opening…"
      : "Saving…"
    : done
      ? nextHref
        ? "Next lesson →"
        : isLast && quizBound
          ? "Take the assessments →"
          : "Finish course →"
      : nextHref
        ? "Complete & continue →"
        : isLast && quizBound
          ? "Complete & take assessments →"
          : "Complete & finish →";

  return (
    <footer className="mt-4 flex flex-col gap-4 border-t-2 border-line pt-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          className={done ? "btn" : "btn btn-accent"}
          onClick={() => void completeAndContinue()}
          disabled={saving}
          aria-label={nextHref ? "Mark lesson complete and open the next lesson" : isLast && quizBound ? "Mark lesson complete and take the assessments" : "Mark lesson complete and finish the course"}
        >
          {buttonLabel}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-right text-sm text-bad">
          {error}
        </p>
      )}

      <nav className="grid gap-3 sm:grid-cols-2">
        {prevHref ? (
          <Link href={prevHref} className="card card-hover p-4">
            <span className="meta">← Previous</span>
            <p className="mt-1 text-sm">{prevLabel}</p>
          </Link>
        ) : (
          <span />
        )}
        {nextHref ? (
          <Link href={nextHref} className="card card-hover p-4 sm:text-right">
            <span className="meta">Next →</span>
            <p className="mt-1 text-sm">{nextLabel}</p>
          </Link>
        ) : (
          // On a quiz-bound final lesson the primary button already heads to
          // the assessments, so this card stays the way back to the course.
          <Link href={`/course/${courseSlug}`} className="card card-hover p-4 sm:text-right">
            <span className="meta">Finish →</span>
            <p className="mt-1 text-sm">Back to the course</p>
          </Link>
        )}
      </nav>
    </footer>
  );
}
