"use client";

import { Printer } from "lucide-react";

/**
 * Opens the browser print dialog — which is also "Save as PDF" on every
 * modern browser. The print stylesheet in globals.css strips the site chrome
 * and theme colours so only the sheet itself lands on the paper.
 */
export function PrintButton() {
  return (
    <button type="button" className="btn" onClick={() => window.print()}>
      <Printer aria-hidden className="size-4" />
      Print / save as PDF
    </button>
  );
}
