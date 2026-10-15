import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-4 py-20">
      <p className="meta">404</p>
      <h1 className="font-display text-4xl font-semibold">No such page.</h1>
      <p className="max-w-md text-sm text-ink-soft">
        That route does not exist in the studio. Try the dashboard or open a course from the
        library.
      </p>
      <div className="flex gap-3">
        <Link href="/dashboard" className="btn btn-accent">
          Dashboard
        </Link>
        <Link href="/library" className="btn">
          Library
        </Link>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>
    </div>
  );
}