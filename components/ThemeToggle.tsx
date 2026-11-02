"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MODES, applyMode, readMode, readNight, themeControlHint, writeMode } from "@/lib/ui/theme.mjs";

type Mode = "auto" | "light" | "dark";

const LABEL: Record<Mode, string> = { auto: "Auto", light: "Light", dark: "Dark" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

function apply(mode: Mode) {
  // Keeps night vision on if it is: night forces dark whatever the mode.
  const theme = applyMode(document, mode, window.matchMedia(DARK_QUERY).matches);
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
  const [night, setNight] = useState(false);

  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const m = readMode() as Mode;
    setMode(m);
    // Re-apply the saved mode (idempotent) and tell listeners the starting theme.
    apply(m);
    setNight(readNight());
    // NightToggle fires this after it changes the saved setting.
    const onTheme = () => setNight(readNight());
    window.addEventListener("seeksat:theme", onTheme);
    return () => window.removeEventListener("seeksat:theme", onTheme);
  }, []);

  const choose = useCallback((next: Mode) => {
    setMode(next);
    writeMode(next);
    apply(next);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1
      : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = MODES.indexOf(mode ?? "auto");
    const to = MODES[(at + step + MODES.length) % MODES.length] as Mode;
    choose(to);
    groupRef.current?.querySelectorAll<HTMLElement>("[role=radio]")[MODES.indexOf(to)]?.focus();
  };

  const current: Mode = mode ?? "auto";
  const next = MODES[(MODES.indexOf(current) + 1) % MODES.length] as Mode;

  return (
    <div className="theme-toggle" data-ready={mode ? "true" : "false"} data-night={night ? "true" : "false"} title={themeControlHint(night)}>
      <div className="theme-toggle__group" role="radiogroup" aria-label="Theme" aria-description={themeControlHint(night)} ref={groupRef} onKeyDown={onKeyDown}>
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
        aria-description={themeControlHint(night)}
        onClick={() => choose(next)}
      >
        {LABEL[current]}
      </button>
    </div>
  );
}
