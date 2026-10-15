"use client";

/**
 * Segment error boundary. Next 16 hands the boundary a `retry` callback
 * (the older `reset` name is gone) that re-renders the failed segment.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4 py-20">
      <p className="meta">Something broke</p>
      <h1 className="font-display text-3xl font-semibold">This page failed to load.</h1>
      <p className="max-w-md text-sm text-ink-soft">
        {error.message || "An unexpected error occurred while rendering this page."}
      </p>
      <button className="btn btn-accent" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
