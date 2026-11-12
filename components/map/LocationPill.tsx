"use client";

import { useHomeStore } from "@/lib/home/store";
import Button from "@/components/ui/Button";

/**
 * The place passes are worked out for, in the header: "📍 Chicago ▾", or
 * "📍 Set location" before there is one. Opens the location sheet. Hidden
 * until the saved prefs load, so a returning visitor never sees "Set
 * location" flash.
 */
export default function LocationPill({ onOpen }: { onOpen: () => void }) {
  const hydrated = useHomeStore((s) => s.hydrated);
  const location = useHomeStore((s) => s.prefs.location);

  return (
    <Button
      size="sm"
      className="location-pill"
      data-ready={hydrated ? "true" : "false"}
      aria-haspopup="dialog"
      aria-label={location ? `Passes from ${location.name}. Change location` : "Set location"}
      onClick={onOpen}
    >
      <span aria-hidden="true">📍</span>
      <span className="location-pill__name">{location ? location.name : "Set location"}</span>
      {location && <span className="location-pill__caret" aria-hidden="true">▾</span>}
    </Button>
  );
}
