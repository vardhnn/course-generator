"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered view current while something is running: the
 * dashboard mounts this while a course is generating, so the GeneratingCard's
 * stage readout advances without the user having to reload — and stops
 * polling the moment nothing is running (or the tab is hidden).
 *
 * router.refresh() re-runs the server component without remounting client
 * state, so an open menu or a half-typed form elsewhere survives the poll.
 */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  return null;
}
