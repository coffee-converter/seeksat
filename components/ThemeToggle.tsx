"use client";

import { useCallback, useEffect, useState } from "react";
import { MODES, applyMode, readMode, readNight, themeControlHint, writeMode } from "@/lib/ui/theme.mjs";
import Button from "@/components/ui/Button";
import Segmented from "@/components/ui/Segmented";

export type Mode = "auto" | "light" | "dark";

export const LABEL: Record<Mode, string> = { auto: "Auto", light: "Light", dark: "Dark" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

function apply(mode: Mode) {
  // Keeps night vision on if it is: night forces dark whatever the mode.
  const theme = applyMode(document, mode, window.matchMedia(DARK_QUERY).matches);
  window.dispatchEvent(new CustomEvent("seeksat:theme", { detail: theme }));
}

/**
 * The saved theme mode (null until read after mount), whether night vision is
 * on, and `choose`, which saves and applies a mode. On mount it re-applies the
 * saved mode (idempotent) and tells listeners the starting theme.
 */
export function useThemeMode() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [night, setNight] = useState(false);

  useEffect(() => {
    const m = readMode() as Mode;
    setMode(m);
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

  return { mode, night, choose };
}

/**
 * Auto / Light / Dark. A Segmented radio group; under 700 px a single button
 * that cycles through the three (styles in app/home.css). The mode is read
 * after mount, so the server and first client render match: until then the
 * same-size control is hidden.
 */
export default function ThemeToggle() {
  const { mode, night, choose } = useThemeMode();
  const current: Mode = mode ?? "auto";
  const next = MODES[(MODES.indexOf(current) + 1) % MODES.length] as Mode;

  return (
    <div className="theme-toggle" data-ready={mode ? "true" : "false"} data-night={night ? "true" : "false"} title={themeControlHint(night)}>
      <div className="theme-toggle__group">
        <Segmented
          label="Theme"
          description={themeControlHint(night)}
          options={(MODES as Mode[]).map((m) => ({ value: m, label: LABEL[m] }))}
          value={current}
          onChange={choose}
        />
      </div>
      <Button
        size="sm"
        className="theme-toggle__cycle"
        aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[next]}.`}
        aria-description={themeControlHint(night)}
        onClick={() => choose(next)}
      >
        {LABEL[current]}
      </Button>
    </div>
  );
}
