"use client";

import { useState } from "react";

interface Source {
  id: string;
  title: string;
  publisher: string;
  reliability: number;
  snippet: string;
  url: string;
}

function tone(reliability: number) {
  if (reliability >= 85) return "text-ok";
  if (reliability >= 70) return "text-warn";
  return "text-ink-faint";
}

/**
 * Sources are provenance, not curriculum: a learner rarely needs them open.
 * Collapsed by default so the course page stays focused on the modules.
 */
export function SourcesDisclosure({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const sorted = [...sources].sort((a, b) => b.reliability - a.reliability);

  if (sorted.length === 0) return null;

  return (
    <details
      className="panel overflow-hidden"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] text-ink-soft hover:text-ink">
        <span>
          Sources <span className="tabular-nums text-ink-faint">· {sorted.length}</span>
        </span>
        <span aria-hidden className="text-base leading-none">
          {open ? "−" : "+"}
        </span>
      </summary>

      {open && (
        <div className="border-t-2 border-line-soft px-5 py-4">
          <p className="mb-3 text-xs text-ink-soft">
            Scored for reliability. Only excerpts that pass the gate reach the curriculum.
          </p>
          <ul className="flex flex-col gap-3">
            {sorted.map((s) => (
              <li key={s.id} className="border-b border-line-soft pb-3 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {s.title}
                  </a>
                  <span className={`meta tabular-nums ${tone(s.reliability)}`}>
                    {s.reliability}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">{s.snippet}</p>
                <p className="meta mt-1 truncate">{s.publisher}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}