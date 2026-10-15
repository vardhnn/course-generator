"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListTree } from "lucide-react";

export interface OutlineLesson {
  id: string;
  title: string;
  moduleTitle: string;
  kind: string;
  done: boolean;
}

/**
 * The whole curriculum on any lesson page, so a reader can jump from module 1
 * straight to lesson 9 of module 3 without walking prev/next the whole way.
 * A native <details> keeps it keyboard-accessible and collapsed by default —
 * no floating panel to manage, and it prints sensibly too.
 *
 * The current lesson is marked from the pathname (not a prop) so client-side
 * navigation keeps it in sync without a re-render from the server.
 */
export function LessonOutline({
  lessons,
  courseSlug,
  currentId,
}: {
  lessons: OutlineLesson[];
  courseSlug: string;
  currentId: string;
}) {
  const pathname = usePathname();

  // Group by module preserving encounter order.
  const groups: { title: string; items: OutlineLesson[] }[] = [];
  for (const l of lessons) {
    const last = groups[groups.length - 1];
    if (last && last.title === l.moduleTitle) last.items.push(l);
    else groups.push({ title: l.moduleTitle, items: [l] });
  }

  return (
    <details className="panel overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 font-mono text-xs tracking-[0.06em] text-ink-soft uppercase transition-colors hover:text-ink">
        <span className="flex items-center gap-2">
          <ListTree aria-hidden className="size-3.5" />
          Course outline
        </span>
        <span aria-hidden className="text-base leading-none">
          <span className="[details[open]_&]:hidden">+</span>
          <span className="hidden [details[open]_&]:inline">−</span>
        </span>
      </summary>
      <nav aria-label="Course outline" className="max-h-[50vh] overflow-y-auto border-t-2 border-line-soft px-4 py-3">
        {groups.map((g, gi) => (
          <div key={g.title} className="mb-3 last:mb-0">
            <p className="meta mb-1">
              {String(gi + 1).padStart(2, "0")} · {g.title}
            </p>
            <ul className="flex flex-col">
              {g.items.map((l) => {
                const current = l.id === currentId;
                return (
                  <li key={l.id}>
                    <Link
                      href={`/course/${courseSlug}/lesson/${l.id}`}
                      aria-current={current ? "page" : undefined}
                      className={[
                        "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors",
                        current
                          ? "bg-accent-wash/60 font-medium text-ink"
                          : "text-ink-soft hover:bg-surface-2 hover:text-ink",
                      ].join(" ")}
                    >
                      <span
                        aria-hidden
                        className={`w-3 text-center font-mono text-xs ${l.done ? "text-ok" : "text-ink-faint"}`}
                      >
                        {l.done ? "●" : l.kind === "playground" ? "▷" : "○"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{l.title}</span>
                      {current && <span className="meta text-[10px]">here</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </details>
  );
}
