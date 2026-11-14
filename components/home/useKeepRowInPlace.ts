"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { keptScrollTop } from "@/lib/ui/open-row.mjs";
import { PASS_VIEW_QUERY } from "@/lib/ui/pass-view";

/** The docked layout: the side panel scrolls, not the window. */
/** The map beside a scrolling panel (lib/ui/layout.ts SIDE_QUERY). */
export { SIDE_QUERY as DOCKED_QUERY } from "@/lib/ui/layout";
import { SIDE_QUERY as DOCKED_QUERY } from "@/lib/ui/layout";

const keep = keptScrollTop as (o: { beforeTop: number; afterTop: number; scrollTop: number; maxScrollTop: number }) => number;

type Pending = { el: HTMLElement; top: number; box: HTMLElement };

/**
 * Keeps a tapped row's top where it was on screen when opening it closes
 * another row above it. Call the returned function with the row's element
 * before the state change; the scroll is put back after the next commit,
 * before paint. The scroller is the window on phones and the docked panel
 * (`.map-shell__panel`) from 1100 px. The browser's own scroll anchoring is
 * held off meanwhile so the two never both correct.
 */
export function useKeepRowInPlace(): (el: HTMLElement) => void {
  const pending = useRef<Pending | null>(null);
  // Puts the scroller's overflow-anchor back; set while it is held off.
  const restore = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const { el, top, box } = p;
    if (el.isConnected) {
      const next = keep({
        beforeTop: top,
        afterTop: el.getBoundingClientRect().top,
        scrollTop: box.scrollTop,
        maxScrollTop: box.scrollHeight - box.clientHeight,
      });
      if (next !== box.scrollTop) box.scrollTop = next;
    }
    const undo = restore.current;
    if (undo) requestAnimationFrame(undo);
  });

  return useCallback((el: HTMLElement) => {
    // On a phone an open row is the pinned pass view, not a row in the list:
    // nothing to keep in place (the shell puts the scroll back on close).
    if (window.matchMedia(PASS_VIEW_QUERY).matches) return;
    restore.current?.();
    const panel = window.matchMedia(DOCKED_QUERY).matches ? el.closest<HTMLElement>(".map-shell__panel") : null;
    const box = panel ?? (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    const was = box.style.overflowAnchor;
    box.style.overflowAnchor = "none";
    const undo = () => {
      if (restore.current !== undo) return;
      restore.current = null;
      box.style.overflowAnchor = was;
    };
    restore.current = undo;
    pending.current = { el, top: el.getBoundingClientRect().top, box };
  }, []);
}
