"use client";

import { useEffect, useLayoutEffect } from "react";
import { applyTheme, readMode, resolveTheme, syncTheme } from "@/lib/ui/theme.mjs";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Keeps <html data-theme> right on every route. Covers pages where the inline
 * pre-paint script did not run (Next's error shell) or client navigations
 * that lost the attribute, and follows the system in auto mode. Renders nothing.
 */
export default function ThemeSync() {
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const before = document.documentElement.dataset.theme;
    const theme = syncTheme(document, window.localStorage, mq);
    if (before !== theme) window.dispatchEvent(new CustomEvent("seeksat:theme", { detail: theme }));
    const onChange = () => {
      if (readMode() !== "auto") return;
      applyTheme(document, resolveTheme("auto", mq.matches));
      window.dispatchEvent(new CustomEvent("seeksat:theme", { detail: document.documentElement.dataset.theme }));
    };
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);
  return null;
}
