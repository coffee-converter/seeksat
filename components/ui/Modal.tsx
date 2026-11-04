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
  /** Keeps the title for screen readers only (still the dialog's name); the
   *  actions then start at the left and Close sits at the far right. */
  hideTitle?: boolean;
  /** Lets a dialog wider than tall (the radio chart) use the full width. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * The one dialog. Tab is trapped inside, Escape closes (captured, so the
 * page's own Esc handlers never see it), the page behind does not scroll,
 * focus starts on Close and returns to the opener on close.
 */
export default function Modal({ open, onClose, title, size = "dialog", tone = "page", actions, labelledBy, hideTitle = false, wide = false, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  // Declared before the focus effect: the trap notes the opener first.
  useFocusTrap(ref, open);
  // Latest onClose, so an inline callback never re-runs the effects below.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = was; };
  }, [open]);

  if (!open) return null;
  return (
    <div ref={ref} className={cx(modalClass({ size, tone }))} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId}>
      <div className="modal__backdrop" onClick={() => onCloseRef.current()} />
      <div className={cx("modal__panel", wide && "modal__panel--wide")}>
        <header className={cx("modal__head", hideTitle && "modal__head--bare")}>
          <h2 id={titleId} className={cx("modal__title", hideTitle && "sr-only")}>{title}</h2>
          <div className="modal__actions">
            {actions}
            <Button ref={closeRef} variant="quiet" tone="danger" iconOnly aria-label="Close" onClick={() => onCloseRef.current()}>
              <span aria-hidden="true">✕</span>
            </Button>
          </div>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
