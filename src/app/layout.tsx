import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { BootScript } from "@/components/boot-script";

export const metadata: Metadata = {
  // Pages set their own title; this template brands them. The landing page
  // opts out with { absolute: "Retro Course Studio" }.
  title: {
    default: "Retro Course Studio",
    template: "%s | Retro Course Studio",
  },
  description:
    "Describe what you want to learn. The studio researches, teaches and assesses — built on a warm-paper, ink-ruled interface.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className="font-sans">
      <body>
        <BootScript />
        <div className="relative z-10 flex min-h-screen flex-col">
          <SiteHeader />
      <div className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 md:px-8">
        <main className="min-w-0">{children}</main>
      </div>
          <footer className="relative z-10 border-t-2 border-line px-5 py-6 md:px-8">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
              <span className="meta">Retro Course Studio</span>
              <span className="meta">
                Every course researched, drafted and graded from its own lesson text
              </span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}