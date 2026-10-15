"use client";

import { useEffect } from "react";

/**
 * A thin reading-progress line pinned under the sticky header on long-form
 * pages. The lesson page already shows course-level progress; this one answers
 * "how much of *this* lesson is left" while scrolling.
 *
 * Passive listener + rAF-throttled writes: no layout thrash on every wheel
 * event, and nothing to do when the page fits in the viewport.
 */
export function ScrollProgress() {
  useEffect(() => {
    const bar = document.getElementById("scroll-progress-fill");
    if (!bar) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const percent = max <= 0 ? 100 : Math.min(100, Math.max(0, (doc.scrollTop / max) * 100));
      bar.style.width = `${percent}%`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-[var(--header-h,3.25rem)] z-30 h-[3px] bg-transparent"
    >
      <span
        id="scroll-progress-fill"
        className="block h-full bg-accent transition-[width] duration-100 ease-out motion-reduce:transition-none"
        style={{ width: "0%" }}
      />
    </div>
  );
}
