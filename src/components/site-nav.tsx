"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/library", label: "Library" },
  { href: "/progress", label: "Progress" },
  { href: "/settings", label: "Settings" },
];

/**
 * A compact horizontal strip that sits centred in the header. Labels only —
 * the glyphs were decorative and competed with the text at this size. Squared
 * corners keep it in the same hard-edged language as the rest of the studio.
 */
export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="min-w-0">
      <ul className="flex items-center justify-start gap-1 overflow-x-auto py-0.5 md:justify-center">
        {LINKS.map((link) => {
          const active =
            link.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(link.href);
          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "block border px-2 py-1 font-mono text-[10px] tracking-[0.1em] whitespace-nowrap uppercase transition-colors duration-150",
                  active
                    ? "border-line bg-ink text-surface"
                    : "border-transparent text-ink-soft hover:border-line hover:bg-surface hover:text-ink",
                ].join(" ")}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}