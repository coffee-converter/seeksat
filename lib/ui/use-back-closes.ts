"use client";

import { useEffect, useRef } from "react";

/** Marks the history entry an open overlay pushed, with how many overlays
 *  are open there (a chart opened over the phone pass view is the second). */
const KEY = "seeksatOverlay";

/** Overlays open at the current history entry. */
const depthNow = () => {
  const v = (window.history.state as Record<string, unknown> | null)?.[KEY];
  return typeof v === "number" ? v : v ? 1 : 0;
};

/**
 * Makes the browser's Back button close an overlay (a chart that fills a
 * phone screen) rather than leave the page. Opening pushes one history entry
 * for the same URL; Back pops it and calls `close`. Closing any other way (the
 * close button, Esc, a click outside) steps back over that entry, so it never
 * lingers. The entry keeps the router's own history state alongside the mark.
 * Leaving the page with the overlay open leaves the entry: stepping back from
 * the next page then lands here with the overlay closed.
 */
export function useBackCloses(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  const pushed = useRef(false);
  // This overlay's depth: its entry, and any over it, are at least this deep.
  const depth = useRef(0);
  const ours = () => depthNow() >= depth.current;

  useEffect(() => {
    if (!open) {
      if (pushed.current) {
        pushed.current = false;
        // Step back over this entry and any opened over it (a chart over the
        // pass view closes with it), so no empty entry is left for Back.
        const over = depthNow() - depth.current;
        if (over >= 0) window.history.go(-(over + 1));
      }
      return;
    }
    if (!pushed.current) {
      const state = (window.history.state as Record<string, unknown> | null) ?? {};
      depth.current = depthNow() + 1;
      window.history.pushState({ ...state, [KEY]: depth.current }, "", window.location.href);
      pushed.current = true;
    }
    const onPop = () => {
      if (!pushed.current || ours()) return;
      pushed.current = false;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);
}
