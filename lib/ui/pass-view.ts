// lib/ui/pass-view.ts - The phone pass view: with a pass open on a phone, the
// screen becomes the map on top and that pass's card filling the rest, the
// list hidden behind. The lists (home, satellite page) report their open row;
// the shell (MapLayoutShell) lays the screen out; Back closes it.
"use client";

import { useEffect } from "react";
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
  useEffect(() => () => usePassViewStore.getState().set(false), []);
}
