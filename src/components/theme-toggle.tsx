"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) ?? "dark");
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("rcs-theme", next);
    setTheme(next);
  }

  const label = `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
  const Icon = mounted && theme === "light" ? Sun : Moon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      className="border-2 border-line text-ink transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[2px_2px_0_var(--ink)] hover:bg-surface hover:text-ink active:translate-y-0 active:shadow-none"
      aria-label={label}
      title={label}
    >
      <Icon aria-hidden className="size-4" />
    </Button>
  );
}