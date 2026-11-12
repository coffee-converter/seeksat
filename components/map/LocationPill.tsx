"use client";

import { useHomeStore } from "@/lib/home/store";
import Button from "@/components/ui/Button";
import { placeName } from "@/lib/home/places.mjs";

/**
 * The place passes are worked out for, in the header: "📍 Chicago ▾", or
 * "📍 Set location" before there is one. Opens the location sheet. Hidden
 * until the saved prefs load, so a returning visitor never sees "Set
 * location" flash.
 */
export default function LocationPill({ onOpen }: { onOpen: () => void }) {
  const hydrated = useHomeStore((s) => s.hydrated);
  const location = useHomeStore((s) => s.prefs.location);
  const name = location ? placeName(location) : null;

  return (
    <Button
      size="sm"
      className="location-pill"
      data-ready={hydrated ? "true" : "false"}
      aria-haspopup="dialog"
      aria-label={name ? `Passes from ${name}. Change location` : "Set location"}
      onClick={onOpen}
    >
      <span aria-hidden="true">📍</span>
      <span className="location-pill__name">{name ?? "Set location"}</span>
      {name && <span className="location-pill__caret" aria-hidden="true">▾</span>}
    </Button>
  );
}
