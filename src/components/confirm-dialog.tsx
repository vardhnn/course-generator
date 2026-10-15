"use client";

import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";

/**
 * A themed confirmation popup built on the native <dialog> element, which
 * already gives us a modal context, an Escape-to-dismiss path and a backdrop —
 * without another dependency. Clicking the backdrop closes it, matching the
 * behaviour every other surface in the studio has.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Keep it",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      onClick={(e) => {
        // A click on the backdrop targets the dialog itself.
        if (e.target === ref.current) onCancel();
      }}
      className="m-auto w-[min(26rem,90vw)] border-2 border-line bg-paper p-0 text-ink shadow-[5px_5px_0_var(--ink)] backdrop:bg-ink/50"
      aria-labelledby="confirm-title"
    >
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-bad" />
          <div>
            <h2 id="confirm-title" className="font-display text-lg font-semibold">
              {title}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">{body}</p>
          </div>
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="btn border-bad bg-bad text-white" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
