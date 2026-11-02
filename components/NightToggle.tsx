"use client";

import { useEffect, useState } from "react";
import { applyMode, readMode, readNight, writeNight } from "@/lib/ui/theme.mjs";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Night vision: turns the whole app dim red (the filter on html[data-night]
 * in app/globals.css) to keep dark adaptation outdoors. Separate from the
 * Auto / Light / Dark mode, which stays saved and comes back when this is
 * turned off. Under 480 px it is an icon button (styles in app/home.css).
 * Read after mount, like ThemeToggle, so server and client renders match.
 */
export default function NightToggle() {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    setOn(readNight());
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    writeNight(next);
    const theme = applyMode(document, readMode(), window.matchMedia(DARK_QUERY).matches);
    window.dispatchEvent(new CustomEvent("seeksat:theme", { detail: theme }));
  };

  return (
    <button
      type="button"
      className="night-toggle"
      data-ready={on === null ? "false" : "true"}
      aria-pressed={on === true}
      aria-label="Night vision"
      onClick={toggle}
    >
      <svg className="night-toggle__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="night-toggle__label">Night vision</span>
    </button>
  );
}
