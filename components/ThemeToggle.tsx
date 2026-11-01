"use client";

import { useCallback, useEffect, useState } from "react";
import { MODES, applyTheme, readMode, resolveTheme, writeMode } from "@/lib/ui/theme.mjs";

type Mode = "auto" | "light" | "dark";

const LABEL: Record<Mode, string> = { auto: "Auto", light: "Light", dark: "Dark" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

function apply(mode: Mode) {
  const theme = resolveTheme(mode, window.matchMedia(DARK_QUERY).matches);
  applyTheme(document, theme);
  window.dispatchEvent(new CustomEvent("seeksat:theme", { detail: theme }));
}

/**
 * Auto / Light / Dark. A segmented radio group; under 480 px a single button
 * that cycles through the three (styles in app/home.css). The mode is read
 * after mount, so the server and first client render match: until then the
 * same-size control is hidden.
 */
export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    setMode(readMode() as Mode);
  }, []);

  // In auto, follow the system as it changes.
  useEffect(() => {
    if (mode !== "auto") return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => apply("auto");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const choose = useCallback((next: Mode) => {
    setMode(next);
    writeMode(next);
    apply(next);
  }, []);

  const current: Mode = mode ?? "auto";
  const next = MODES[(MODES.indexOf(current) + 1) % MODES.length] as Mode;

  return (
    <div className="theme-toggle" data-ready={mode ? "true" : "false"}>
      <div className="theme-toggle__group" role="radiogroup" aria-label="Theme">
        {(MODES as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={current === m}
            tabIndex={mode && current !== m ? -1 : 0}
            className="theme-toggle__opt"
            onClick={() => choose(m)}
          >
            {LABEL[m]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="theme-toggle__cycle"
        aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[next]}.`}
        onClick={() => choose(next)}
      >
        {LABEL[current]}
      </button>
    </div>
  );
}
