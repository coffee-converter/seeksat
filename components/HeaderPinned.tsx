"use client";

import { useEffect } from "react";

/** Event fired after --header-pinned changes, so observers can re-read it. */
export const HEADER_PINNED_EVENT = "seeksat:header-pinned";

/**
 * Publishes how much of the sticky site header stays on screen while the page
 * scrolls, as --header-pinned on <html> (so dialogs, which render into <body>,
 * can sit under the header too). That is its height plus its
 * computed `top` (negative on phones, where the wordmark row scrolls away).
 * The header grows with the offline banner and the saved-age line, so it is
 * measured rather than hard-coded.
 */
export default function HeaderPinned() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".map-shell__top");
    const root = document.documentElement;
    if (!header) return;
    const update = () => {
      const top = parseFloat(getComputedStyle(header).top) || 0;
      const next = `${Math.max(0, Math.round(header.getBoundingClientRect().height + top))}px`;
      if (root.style.getPropertyValue("--header-pinned") === next) return;
      root.style.setProperty("--header-pinned", next);
      window.dispatchEvent(new Event(HEADER_PINNED_EVENT));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty("--header-pinned");
    };
  }, []);
  return null;
}
