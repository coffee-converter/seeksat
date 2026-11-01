"use client";

import { useEffect, useState } from "react";

export type ResolvedTheme = "dark" | "light";

/**
 * The resolved theme. "dark" on the server and first client render (so they
 * match), then read from <html data-theme> after mount and kept current from
 * the seeksat:theme event.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>("dark");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    read();
    window.addEventListener("seeksat:theme", read);
    return () => window.removeEventListener("seeksat:theme", read);
  }, []);
  return theme;
}
