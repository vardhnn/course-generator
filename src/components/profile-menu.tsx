"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Award, BookOpen, ChartLine, CircleUserRound, LogOut, Settings } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface Me {
  id: string;
  email: string;
  name: string;
}

/**
 * The library, progress and settings destinations live behind this icon now,
 * so the header bar stays just the wordmark and the primary action.
 *
 * The menu closes on outside click and on Escape, and the sign-out ask uses
 * the same confirmation dialog as a course delete — two different mistakes,
 * but the same undo-ability, so the same interaction.
 */
export function ProfileMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);

  // The menu lives in the root layout, which does not remount on client-side
  // navigation — so a fetch on mount goes stale after signing in or out.
  // Fetching when the menu opens means the state is read at the moment it is
  // actually shown.
  useEffect(() => {
    if (!open || loadingRef.current) return;
    loadingRef.current = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMe(d.user ?? null))
      .catch(() => setMe(null))
      .finally(() => {
        loadingRef.current = false;
        setLoaded(true);
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    setConfirming(false);
    setMe(null);
    setOpen(false);
    setLoading(false);
    startTransition(() => {
      router.push("/");
      router.refresh();
    });
  }

  const links = [
    { href: "/library", label: "Library", icon: BookOpen },
    { href: "/progress", label: "Progress", icon: ChartLine },
    { href: "/certificates", label: "Certificates", icon: Award },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account and sections"
        className={[
          // Same box, border and glyph size as the theme toggle beside it, so
          // the two read as a matched pair. The lift-on-hover mirrors the
          // studio's button language elsewhere.
          "inline-flex size-8 items-center justify-center border-2 border-line text-ink transition-all duration-150",
          "hover:-translate-y-0.5 hover:shadow-[2px_2px_0_var(--ink)] hover:bg-surface active:translate-y-0 active:shadow-none",
          open ? "bg-ink text-surface shadow-[2px_2px_0_var(--ink)]" : "",
        ].join(" ")}
      >
        <CircleUserRound aria-hidden className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-30 mt-2 w-60 border-2 border-line bg-surface p-2 shadow-[4px_4px_0_var(--ink)]"
        >
          {loaded && me && (
            <div className="mb-1 border-b-2 border-line-soft px-2 pb-2 pt-1">
              <p className="font-display text-sm font-semibold truncate">
                {me.name || me.email.split("@")[0]}
              </p>
              <p className="meta truncate text-[10px]">{me.email}</p>
            </div>
          )}
          {loaded && !me && (
            <div className="mb-1 flex flex-col gap-1.5 border-b-2 border-line-soft px-2 pb-2 pt-1">
              <p className="meta text-[10px]">Not signed in</p>
              {/* Identical structure and flex-1 each, so the two labels sit on
                  the same baseline and start at mirrored offsets — an icon on
                  only one of them is what made the text look misaligned. */}
              <div className="flex gap-1.5">
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="btn btn-accent h-8 flex-1 justify-center px-2 text-[10px]"
                >
                  Sign in
                </Link>
                <Link
                  href="/login?mode=signup"
                  onClick={() => setOpen(false)}
                  className="btn h-8 flex-1 justify-center px-2 text-[10px]"
                >
                  Sign up
                </Link>
              </div>
            </div>
          )}

          <ul className="flex flex-col">
            {links.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </Link>
              </li>
            ))}
            {me && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setConfirming(true);
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-bad transition-colors hover:bg-bad/10"
                >
                  <LogOut aria-hidden className="size-4" />
                  Log out
                </button>
              </li>
            )}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Log out?"
        body="Your courses stay in the studio either way. Sign back in to see your progress, assessments and certificates again."
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        busy={pending || loading}
        onConfirm={logout}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
