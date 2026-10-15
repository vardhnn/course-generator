"use client";

import { BadgeCheck, Circle, CircleSlash, Loader2, Loader } from "lucide-react";

export interface StageRun {
  stage: string;
  label: string;
  detail: string;
  status: string;
  progress: number;
  message: string;
}

/**
 * A course being written right now. Deliberately not a link: there is nothing
 * to open until the studio finishes, and a dead link next to a spinner just
 * invites mis-clicks.
 *
 * Laid out as a single full-width row that grows horizontally. The earlier
 * vertical list made the card so tall that its grid neighbours stretched to
 * match, which read as "every course is still generating".
 *
 * Progress is read from the persisted GenerationRun rows, so the steps shown
 * are the steps that actually ran — not a decorative loop.
 */
export function GeneratingCard({
  title,
  level,
  stages,
  stale = false,
}: {
  title: string;
  level: string;
  stages: StageRun[];
  /** The run stopped updating — stop the animation and say so. */
  stale?: boolean;
}) {
  const done = stages.filter((s) => s.status === "done").length;
  const failed = stages.find((s) => s.status === "failed");
  const percent = Math.round((done / Math.max(stages.length, 1)) * 100);
  const active = !stale ? stages.find((s) => s.status === "running") : undefined;

  return (
    <div
      className="panel hatch relative overflow-hidden p-4"
      aria-live="polite"
      aria-busy={stale ? undefined : "true"}
      data-testid="generating-card"
      data-stale={stale ? "true" : undefined}
    >
      {/* Sweeping highlight: the one thing a finished card can never do. */}
      {!stale && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-24 -skew-x-12 bg-accent-wash/40 motion-safe:animate-[sweep_2.4s_ease-in-out_infinite]"
        />
      )}

      {/* Header row: identity and overall progress, side by side. */}
      <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {/* .meta is unlayered and would beat a Tailwind colour on the same
              element, so the status colour lives on an inner span. */}
          <p className="meta flex shrink-0 items-center gap-1.5">
            <span
              className={
                stale
                  ? "flex items-center gap-1.5 text-bad"
                  : "flex items-center gap-1.5 text-accent"
              }
            >
              {stale ? (
                <>
                  <CircleSlash aria-hidden className="size-3.5" />
                  Stopped
                </>
              ) : (
                <>
                  <Loader2 aria-hidden className="size-3.5 motion-safe:animate-spin" />
                  Generating
                </>
              )}
            </span>
          </p>
          <h3 className="font-display truncate text-base leading-tight font-semibold">
            {title}
          </h3>
          <span className={`chip shrink-0 text-[11px]${stale ? "" : " animate-pulse"}`}>
            {level}
          </span>
        </div>

        <p className="relative shrink-0 text-xs text-ink-soft">
          {stale
            ? "The studio stopped updating on this run."
            : active
              ? active.message || `${active.label}…`
              : "Preparing the studio…"}
        </p>
      </div>

      {/* Progress bar: one full-width line, no vertical bulk. */}
      <div className="relative mt-3">
        <div
          className="bar"
          role="progressbar"
          aria-valuenow={stale ? undefined : percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Generation ${stale ? "stopped" : `${percent}% complete`}`}
        >
          <span
            className="block h-full bg-accent transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${stale ? percent : Math.max(percent, active ? 4 : 0)}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="meta">
            Step {Math.min(done + (active ? 1 : 0), stages.length)} of {stages.length}
          </span>
          <span className="meta tabular-nums">{stale ? "stopped" : `${percent}%`}</span>
        </div>
      </div>

      {/* Stages run left-to-right; each is a fixed-width chip so the row's
          height never depends on how many stages there are. */}
      <ol className="relative mt-3 flex flex-wrap items-center gap-1.5">
        {stages.map((s) => {
          const tone =
            s.status === "pending"
              ? "border-line-soft text-ink-faint opacity-60"
              : s.status === "done"
                ? "border-ok/60 text-ok"
                : s.status === "failed" || (stale && s.status === "running")
                  ? "border-bad/60 text-bad"
                  : "border-accent bg-accent-wash/40 text-accent";
          const icon =
            s.status === "done" ? (
              <BadgeCheck aria-hidden className="size-3" />
            ) : s.status === "failed" || (stale && s.status === "running") ? (
              <Circle aria-hidden className="size-3 fill-bad text-bad" />
            ) : s.status === "running" ? (
              <Loader aria-hidden className="size-3 motion-safe:animate-spin" />
            ) : (
              <Circle aria-hidden className="size-3" />
            );
          return (
            <li
              key={s.stage}
              title={s.detail}
              data-stage={s.stage}
              data-status={s.status}
              className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase transition-colors duration-300 ${tone}`}
            >
              <span className="sr-only">
                {s.status === "done" ? "completed: " : s.status === "running" ? "in progress: " : ""}
              </span>
              {icon}
              {s.label}
            </li>
          );
        })}
      </ol>

      {failed && !stale && (
        <p className="relative mt-2 text-xs text-bad">
          Stopped at {failed.label.toLowerCase()}.
        </p>
      )}
    </div>
  );
}