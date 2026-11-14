"use client";

import { useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

/** How far a finger moves down before it is a drag, not a tap. */
const SLOP_PX = 6;
/** How long a released sheet takes to spring back or slide away. */
export const SHEET_SETTLE_MS = 180;

/**
 * Drag a bottom sheet down to close it, from a handle (its header, a grab
 * bar): the panel follows the finger, and once let go past a quarter of its
 * height, or flicked, it slides away and `onClose` runs; short of that it
 * springs back. A press that moves less than SLOP_PX stays a tap, and the
 * click that ends a drag is swallowed, so a handle can be a button too.
 * `ignore` names controls inside the handle that never start a drag.
 * Spread the returned handlers on each handle element.
 */
export function useSheetDrag({ panelRef, enabled, onClose, ignore }: {
  panelRef: RefObject<HTMLElement | null>;
  /** Asked at each press (a media query, say). */
  enabled: () => boolean;
  onClose: () => void;
  ignore?: string;
}) {
  const drag = useRef<{ id: number; y0: number; t0: number; dy: number; moving: boolean } | null>(null);
  const swallowClick = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const settle = (panel: HTMLElement, away: boolean) => {
    if (away && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onCloseRef.current();
      requestAnimationFrame(() => { panel.style.transform = ""; panel.style.transition = ""; });
      return;
    }
    panel.style.transition = `transform ${SHEET_SETTLE_MS}ms ease-out`;
    panel.style.transform = away ? "translateY(100%)" : "";
    window.setTimeout(() => {
      if (away) onCloseRef.current();
      // A panel that stays mounted (a list row) comes back in place.
      requestAnimationFrame(() => { panel.style.transform = ""; panel.style.transition = ""; });
    }, SHEET_SETTLE_MS);
  };

  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (e.button !== 0 || !enabled()) return;
      if (ignore && (e.target as HTMLElement).closest(ignore)) return;
      drag.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0, moving: false };
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      const panel = panelRef.current;
      if (!d || d.id !== e.pointerId || !panel) return;
      d.dy = Math.max(0, e.clientY - d.y0);
      if (!d.moving) {
        if (d.dy < SLOP_PX) return;
        d.moving = true;
        d.t0 = performance.now();
        e.currentTarget.setPointerCapture(e.pointerId);
        panel.style.transition = "none";
      }
      panel.style.transform = d.dy ? `translateY(${d.dy}px)` : "";
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      const panel = panelRef.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      if (!d.moving || !panel) return;
      swallowClick.current = true;
      window.setTimeout(() => { swallowClick.current = false; }, 400);
      const speed = d.dy / Math.max(1, performance.now() - d.t0);
      settle(panel, d.dy > panel.offsetHeight * 0.25 || (speed > 0.5 && d.dy > 30));
    },
    onPointerCancel(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      drag.current = null;
      if (d?.moving && d.id === e.pointerId && panelRef.current) settle(panelRef.current, false);
    },
    onClickCapture(e: ReactMouseEvent<HTMLElement>) {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
