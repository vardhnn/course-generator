"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * Deleting a course destroys its lessons, assessments and progress, so the
 * trigger only opens a confirmation dialog; the destructive action happens
 * there, after a second deliberate click.
 *
 * The trigger is sized to the row's chips so the header reads as one control
 * group instead of a mismatched pair.
 */
export function DeleteCourseButton({
  courseId,
  title,
}: {
  courseId: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function remove() {
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Delete failed (${res.status})`);
      }
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-[23px] shrink-0 items-center gap-1 border-2 border-line px-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-bad transition-colors hover:bg-bad hover:text-white"
        aria-label={`Delete ${title}`}
        title={`Delete ${title}`}
      >
        <Trash2 aria-hidden className="size-3" />
        Delete
      </button>

      <ConfirmDialog
        open={open}
        title={`Delete "${title}"?`}
        body="This removes the course along with its lessons, assessments, sources and your progress. It cannot be undone."
        busy={pending}
        onConfirm={remove}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      />

      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </>
  );
}
