// lib/ui/pass-view.ts - The phone pass view: with a pass open on a phone, the
// screen becomes the map on top and that pass's card filling the rest, the
// list hidden behind. The lists (home, satellite page) report their open row;
// the shell (MapLayoutShell) lays the screen out; Back closes it.
"use client";

import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useBackCloses } from "./use-back-closes";
import { useMediaQuery } from "./use-media-query";

/** Phones: the pass view applies under this width (tablets keep the list). */
export const PASS_VIEW_QUERY = "(max-width: 699.98px)";

export const usePassViewStore = create<{
  open: boolean;
  set: (open: boolean) => void;
  /** The page's scroll when a row was tapped open, taken before the pass
   *  view changes the layout (and the browser moves the scroll). */
  scrollY: number | null;
}>((set, get) => ({
  open: false,
  scrollY: null,
  set: (open) => {
    if (get().open !== open) set({ open });
  },
}));

/** A list with an open row: on a phone, turns the pass view on while it is
 *  open, and makes Back close the row rather than leave the page. */
export function usePassView(open: boolean, close: () => void) {
  const phone = useMediaQuery(PASS_VIEW_QUERY);
  const active = open && phone;
  useBackCloses(active, close);
  useEffect(() => {
    usePassViewStore.getState().set(active);
  }, [active]);
  // It behaves as a dialog: Esc closes it, and the page behind the card (the
  // rest of the list, the footer) is inert, so Tab stays in the card and the
  // map and screen readers skip what it covers.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    // Caught first (capture) and kept to itself, so the page's own Esc
    // (leave a satellite page, clear a focus) does not run as well. Typing in
    // a field keeps its Esc.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // A chart or sheet over the card closes first (it handles its own Esc).
      if (document.querySelector("dialog[open], [role='dialog'][aria-modal='true']")) return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    // Everything around the card, inert; again whenever the list changes
    // under it (a new day's group, rows added), so nothing slips back in and
    // the card is never left inside an inert group.
    const made: Element[] = [];
    const apply = () => {
      for (const el of made.splice(0)) el.removeAttribute("inert");
      const card = document.querySelector(".map-shell .pass-row--open");
      const panel = card?.closest(".map-shell__panel");
      for (let el: Element | null | undefined = card; el && panel && el !== panel; el = el.parentElement) {
        for (const sib of Array.from(el.parentElement?.children ?? [])) {
          if (sib !== el && !sib.hasAttribute("inert")) {
            sib.setAttribute("inert", "");
            made.push(sib);
          }
        }
      }
    };
    let raf = requestAnimationFrame(apply);
    const panelEl = document.querySelector(".map-shell__panel");
    const watch = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    if (panelEl) watch.observe(panelEl, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      watch.disconnect();
      cancelAnimationFrame(raf);
      for (const el of made) el.removeAttribute("inert");
    };
  }, [active]);
  useEffect(() => () => usePassViewStore.getState().set(false), []);
}
