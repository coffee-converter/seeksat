"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Button from "./Button";
import { useFocusTrap } from "./useFocusTrap";
import { cx, modalClass } from "@/lib/ui/classes.mjs";
import Icon from "./Icon";

/** Where the sheet is a panel under the header, not a bottom sheet (app/ui.css). */
const DOCKED = "(min-width: 1100px)";
/** How long a released sheet takes to spring back or slide away. */
const SHEET_SETTLE_MS = 180;

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "dialog" is a centred frame over a backdrop; "full" takes over the screen;
   *  "sheet" is a bottom sheet on phones, a 360px panel under the header on desktop. */
  size?: "dialog" | "full" | "sheet";
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
 * The one dialog. Tab is trapped inside, Escape closes (caught on the way
 * down at window and stopped there, so the page's own Esc handlers never see
 * it), the page behind does not scroll,
 * focus starts on Close and returns to the opener on close.
 * It renders into <body>, so no stacking context of the opener's (the phone
 * panel under the sticky map) can paint the map or the top bar over it; the
 * portal waits for mount, as there is no <body> on the server.
 */
export default function Modal({ open, onClose, title, size = "dialog", tone = "page", actions, labelledBy, hideTitle = false, wide = false, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const shown = open && mounted;
  // Declared before the focus effect: the trap notes the opener first.
  useFocusTrap(ref, shown);
  // Latest onClose, so an inline callback never re-runs the effects below.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!shown) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCloseRef.current(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = was; };
  }, [shown]);

  // A phone's bottom sheet closes by dragging it down from its handle or
  // header: past a quarter of its height, or flicked, it slides away; short
  // of that it springs back. Controls in the header still act as controls.
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y0: number; t0: number; dy: number } | null>(null);
  const sheetDrag = size === "sheet";
  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!sheetDrag || e.button !== 0 || window.matchMedia(DOCKED).matches) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, [role='slider']")) return;
    drag.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (panelRef.current) panelRef.current.style.transition = "none";
  };
  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !panelRef.current) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    panelRef.current.style.transform = d.dy ? `translateY(${d.dy}px)` : "";
  };
  const onDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || d.id !== e.pointerId || !panel) return;
    drag.current = null;
    const speed = d.dy / Math.max(1, performance.now() - d.t0);
    const away = e.type === "pointerup" && (d.dy > panel.offsetHeight * 0.25 || (speed > 0.5 && d.dy > 30));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (away && still) { onCloseRef.current(); return; }
    panel.style.transition = `transform ${SHEET_SETTLE_MS}ms ease-out`;
    panel.style.transform = away ? "translateY(100%)" : "";
    if (away) window.setTimeout(() => onCloseRef.current(), SHEET_SETTLE_MS);
  };
  const dragProps = sheetDrag
    ? { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragEnd }
    : {};

  if (!shown) return null;
  return createPortal(
    <div ref={ref} className={cx(modalClass({ size, tone }))} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId}>
      <div className="modal__backdrop" onClick={() => onCloseRef.current()} />
      <div ref={panelRef} className={cx("modal__panel", wide && "modal__panel--wide")}>
        {sheetDrag && <div className="modal__grab" aria-hidden="true" {...dragProps} />}
        <header className={cx("modal__head", hideTitle && "modal__head--bare")} {...dragProps}>
          <h2 id={titleId} className={cx("modal__title", hideTitle && "sr-only")}>{title}</h2>
          <div className="modal__actions">
            {actions}
            <Button ref={closeRef} variant="quiet" tone="danger" iconOnly aria-label="Close" onClick={() => onCloseRef.current()}>
              <Icon name="close" />
            </Button>
          </div>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
