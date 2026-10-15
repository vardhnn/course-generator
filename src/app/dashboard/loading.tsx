/**
 * Loading state for the dashboard (never 404s — a fixed route). Kept at the
 * segment level rather than the root: a root loading boundary streams the
 * shell before a dynamic route's notFound() resolves, which would commit an
 * HTTP 200 for pages that must return 404.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6 py-8" role="status" aria-live="polite">
      <span className="meta">Loading…</span>
      <div className="panel hatch flex flex-col gap-3 p-8">
        <div className="h-4 w-1/3 animate-pulse rounded-sm bg-paper-2" />
        <div className="h-4 w-2/3 animate-pulse rounded-sm bg-paper-2" />
        <div className="h-4 w-1/2 animate-pulse rounded-sm bg-paper-2" />
      </div>
    </div>
  );
}
