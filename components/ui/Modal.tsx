"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Button from "./Button";
import { useFocusTrap } from "./useFocusTrap";
import { cx, modalClass } from "@/lib/ui/classes.mjs";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "dialog" is a centred frame over a backdrop; "full" takes over the screen. */
  size?: "dialog" | "full";
  /** "dark" keeps the dialog dark whatever the page theme (the chart dialogs). */
  tone?: "page" | "dark";
  /** Buttons in the header, left of Close. */
  actions?: ReactNode;
  /** Id of a heading in `children` that names the dialog, instead of `title`. */
  labelledBy?: string;
  children: ReactNode;
}

/**
 * The one dialog. Tab is trapped inside, Escape closes (captured, so the
 * page's own Esc handlers never see it), the page behind does not scroll,
 * focus starts on Close and returns to the opener on close.
 */
export default function Modal({ open, onClose, title, size = "dialog", tone = "page", actions, labelledBy, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  // Declared before the focus effect: the trap notes the opener first.
  useFocusTrap(ref, open);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = was; };
  }, [open]);

  if (!open) return null;
  return (
    <div ref={ref} className={cx(modalClass({ size, tone }))} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId}>
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel">
        <header className="modal__head">
          <h2 id={titleId} className="modal__title">{title}</h2>
          <div className="modal__actions">
            {actions}
            <Button ref={closeRef} variant="quiet" tone="danger" iconOnly aria-label="Close" onClick={onClose}>
              <span aria-hidden="true">✕</span>
            </Button>
          </div>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
