"use client";

import { useEffect, type RefObject } from "react";
import { nextFocusIndex } from "@/lib/a11y/focus-trap.mjs";

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

const shown = (el: HTMLElement) => el.isConnected && el.getClientRects().length > 0;

function controls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.hasAttribute("disabled") && shown(el));
}

// While `active`, Tab and Shift+Tab cycle through the dialog's visible
// controls, and pull focus back in when it has dropped out (a focused
// button that unmounts leaves focus on <body>). On release, focus goes back
// to what had it before, if that is still on screen (switching chart
// dialogs leaves the old one hidden).
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const was = document.activeElement as HTMLElement | null;
    const before = was && was !== document.body ? was : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = controls(root);
      const i = nextFocusIndex(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      e.preventDefault();
      if (i >= 0) list[i].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before && shown(before) && !root.contains(before)) before.focus();
    };
  }, [ref, active]);
}
