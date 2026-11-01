"use client";

import { useEffect, useRef, useState } from "react";

export const FLASH_MS = 700;

/**
 * "is-ticking" for FLASH_MS after `value` changes, then "". Never on the
 * first render, so the server HTML and the first client render agree.
 * A change mid-flash drops the class for a frame and puts it back, which
 * restarts the CSS animation.
 */
export function useFlash(value: string): string {
  const last = useRef(value);
  const [cls, setCls] = useState("");

  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    setCls("");
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setCls("is-ticking"));
    });
    const off = window.setTimeout(() => setCls(""), FLASH_MS + 40);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(off);
    };
  }, [value]);

  return cls;
}
