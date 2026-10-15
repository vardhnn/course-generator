"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Left/right arrow keys move between lessons, the way every reader expects
 * from long-form content. Inputs, textareas, selects and contenteditable
 * elements are excluded so the tutor chat and playground keep their own
 * arrow keys, as are any modified combos (copy/paste etc.).
 */
export function LessonKeys({
  prevHref,
  nextHref,
}: {
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft" && prevHref) {
        e.preventDefault();
        router.push(prevHref);
      } else if (e.key === "ArrowRight" && nextHref) {
        e.preventDefault();
        router.push(nextHref);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevHref, nextHref, router]);

  return null;
}
