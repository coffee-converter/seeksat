"use client";

import { useEffect, useState } from "react";
import { applyMode, readMode, readNight, writeNight } from "@/lib/ui/theme.mjs";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Night vision: turns the whole app dim red (the filter on html[data-night]
 * in app/globals.css) to keep dark adaptation outdoors. Separate from the
 * Auto / Light / Dark mode, which stays saved and comes back when this is
 * turned off. On, it takes the accent outline (pressedLook="accent"), so it
 * never reads as a fourth theme segment. Under 700 px only the icon shows
 * (app/home.css).
 * Read after mount, like ThemeToggle, so server and client renders match.
 */
export default function NightToggle({ stateLabel = false }: { stateLabel?: boolean } = {}) {
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
    <Button
      size="sm"
      pressed={on === true}
      pressedLook="accent"
      className="night-toggle"
      data-ready={on === null ? "false" : "true"}
      aria-label="Night vision"
      onClick={toggle}
    >
      <Icon name="moon" className="night-toggle__icon" />
      {/* In Settings the row already says "Night vision": the state alone. */}
      <span className="night-toggle__label">{stateLabel ? (on ? "On" : "Off") : "Night vision"}</span>
    </Button>
  );
}
