import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileMenu } from "@/components/profile-menu";

/**
 * The three places a returning learner goes — library, progress,
 * certificates — sit in a nav strip beside the wordmark instead of hiding
 * entirely behind the profile icon (which still carries settings and the
 * account actions). The landing page is the root route, so the wordmark
 * points there.
 */
const NAV_LINKS = [
  { href: "/library", label: "Library" },
  { href: "/progress", label: "Progress" },
  { href: "/certificates", label: "Certificates" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b-2 border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-x-3 gap-y-1 px-5 py-2.5 md:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/"
            className="font-display shrink-0 text-lg font-semibold tracking-tight"
          >
            Retro Course Studio
          </Link>
          <nav
            aria-label="Sections"
            className="hidden items-center gap-1 md:flex"
          >
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="px-2 py-1 font-mono text-[11px] tracking-[0.08em] text-ink-soft uppercase transition-colors hover:text-ink"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/generate"
            className="btn btn-accent h-8 items-center gap-1.5 px-2.5 py-0 font-mono text-[11px] uppercase tracking-[0.08em]"
            aria-label="New course"
          >
            <span aria-hidden>+</span>
            <span className="hidden sm:inline">New course</span>
          </Link>
          <ThemeToggle />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
