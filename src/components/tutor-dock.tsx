"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TutorChat } from "@/components/tutor-chat";

/**
 * Floating tutor launcher. Mounted only on course screens so it never appears
 * on the dashboard, library, progress or settings.
 */
export function TutorDock({
  courseId,
  courseSlug,
  courseTitle,
}: {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="tutor-dock-panel"
        aria-label={open ? "Close AI tutor" : "Open AI tutor"}
        title={open ? "Close AI tutor" : "Open AI tutor"}
        className={[
          "fixed right-5 bottom-5 z-40 size-14 rounded-full border-2 border-line transition-all duration-200 [&_svg:not([class*='size-'])]:size-6",
          open
            ? "bg-ink text-surface shadow-[3px_3px_0_var(--accent)]"
            : "bg-accent text-accent-ink shadow-[3px_3px_0_var(--ink)] hover:-translate-y-0.5 hover:shadow-[5px_5px_0_var(--ink)]",
        ].join(" ")}
      >
        {open ? <X aria-hidden /> : <Sparkles aria-hidden />}
      </Button>

      {open && (
        <aside
          id="tutor-dock-panel"
          role="dialog"
          aria-modal="false"
          aria-label="AI tutor"
          className="rise fixed inset-x-3 bottom-24 z-40 max-h-[75vh] overflow-y-auto border-2 border-line bg-paper shadow-[5px_5px_0_var(--ink)] sm:inset-x-auto sm:right-5 sm:w-[26rem] sm:max-h-[calc(100vh-7rem)]"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b-2 border-line bg-paper px-5 py-3">
            <div>
              <p className="meta">AI Tutor</p>
              <p className="font-display text-base font-semibold leading-tight">{courseTitle}</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOpen(false)}
              aria-label="Close AI tutor"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
          <div className="px-5 pb-5">
            <TutorChat courseId={courseId} courseSlug={courseSlug} courseTitle={courseTitle} />
          </div>
        </aside>
      )}
    </>
  );
}