"use client";

import { useHomeStore, type HomeLocation } from "@/lib/home/store";
import { usePlaceZone, viewerZone } from "@/components/usePlaceZone";
import { shownInNote } from "@/lib/time/zone.mjs";
import LocationPrompt from "@/components/home/LocationPrompt";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Where passes are worked out from: a search or the device, then the current
 * place (ticked) and the recent ones. Picking a place replaces the current
 * one (it moves to recent) and closes the sheet.
 */
export default function LocationSheet({ open, onClose }: Props) {
  const location = useHomeStore((s) => s.prefs.location);
  const recent = useHomeStore((s) => s.prefs.recent);
  const choosePlace = useHomeStore((s) => s.choosePlace);
  const pick = (place: HomeLocation) => {
    choosePlace(place);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="sheet" title="Passes from">
      <div className="location-sheet">
        <LocationPrompt variant="sheet" onDone={onClose} />
        {(location || recent.length > 0) && (
          <ul className="location-sheet__places" aria-label="Places">
            {location && <PlaceRow place={location} current onPick={onClose} />}
            {recent.map((p) => (
              <PlaceRow key={`${p.latDeg},${p.lonDeg}`} place={p} onPick={() => pick(p)} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function PlaceRow({ place, current = false, onPick }: { place: HomeLocation; current?: boolean; onPick: () => void }) {
  const tz = usePlaceZone(place.latDeg, place.lonDeg);
  const note = shownInNote(tz, viewerZone(), Date.now());
  return (
    <li>
      <Button variant="quiet" className="location-sheet__place" aria-current={current || undefined} onClick={onPick}>
        <span className="location-sheet__tick" aria-hidden="true">{current ? "✓" : ""}</span>
        <span className="location-sheet__text">
          <span className="location-sheet__name">{place.name}</span>
          {note && <span className="location-sheet__note">{note}</span>}
        </span>
      </Button>
    </li>
  );
}
