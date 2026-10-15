import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The one-step route back to /dashboard, parked above the page header on
 * every top-level surface that is not the dashboard itself. Course pages
 * carry their own breadcrumb hierarchy and are left alone.
 */
export function BackToDashboard({ label = "Dashboard" }: { label?: string }) {
  // Pages lay out as `flex flex-col gap-* py-*`, so the parent gap does the
  // vertical spacing — only the optical pull-back to the left lives here.
  return (
    <Link
      href="/dashboard"
      aria-label={`Back to ${label.toLowerCase()}`}
      className="rise group -ml-1 inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
    >
      <ArrowLeft
        aria-hidden
        className="size-4 transition-transform group-hover:-translate-x-0.5"
      />
      <span>{label}</span>
    </Link>
  );
}
