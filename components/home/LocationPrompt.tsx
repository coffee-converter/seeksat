"use client";

import { useEffect, useId, useRef, useState } from "react";
import { parseLocationInput } from "@/lib/location/maidenhead.mjs";
import { geocodeOne } from "@/lib/pass-finder/geocode.js";
import { MAX_FOLLOWING, POPULAR_IDS } from "@/lib/home/prefs.mjs";
import { useHomeStore, type HomeLocation } from "@/lib/home/store";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";

const DENIED = "Location access was denied. Type a place or grid square instead.";
const UNAVAILABLE = "Your location isn't available right now. Type a place or grid square instead.";
const UNSUPPORTED = "This browser can't share its location. Type a place or grid square instead.";
// A permission prompt dismissed without an answer calls neither callback, so
// give up waiting after this long.
const GPS_GIVE_UP_MS = 20_000;

interface Props {
  /** Called once a location is saved. */
  onDone?: () => void;
  /** "card" is the standalone card with its heading; "sheet" sits in the
   *  location sheet, which names it: the search first, then the device. */
  variant?: "card" | "sheet";
}

// Where the cards are computed from: the device's position, or a place,
// "lat, lon" or grid square typed in. Saves to prefs with its source.
export default function LocationPrompt({ onDone, variant = "card" }: Props) {
  const uid = useId();
  const choosePlace = useHomeStore((s) => s.choosePlace);
  const [text, setText] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Bumped by every save, so a GPS answer arriving after a typed location is ignored.
  const attempt = useRef(0);
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopWaiting = () => {
    if (giveUp.current) clearTimeout(giveUp.current);
    giveUp.current = null;
    setGpsBusy(false);
  };
  useEffect(() => () => {
    if (giveUp.current) clearTimeout(giveUp.current);
    attempt.current += 1;
  }, []);

  const save = (location: HomeLocation) => {
    attempt.current += 1;
    stopWaiting();
    choosePlace(location);
    setMessage(null);
    onDone?.();
  };

  const useDevice = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMessage(UNSUPPORTED);
      return;
    }
    const mine = ++attempt.current;
    setGpsBusy(true);
    setMessage(null);
    if (giveUp.current) clearTimeout(giveUp.current);
    giveUp.current = setTimeout(() => {
      giveUp.current = null;
      setGpsBusy(false);
      setMessage(UNAVAILABLE);
    }, GPS_GIVE_UP_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (attempt.current !== mine) return;
        save({
          name: "My location",
          latDeg: pos.coords.latitude,
          lonDeg: pos.coords.longitude,
          source: "gps",
        });
      },
      (err) => {
        if (attempt.current !== mine) return;
        stopWaiting();
        setMessage(err.code === err.PERMISSION_DENIED ? DENIED : UNAVAILABLE);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
    );
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = text.trim();
    const parsed = parseLocationInput(typed);
    if (!parsed) return;
    if (parsed.kind === "invalid") {
      setMessage(parsed.message);
      return;
    }
    setMessage(null);
    if (parsed.kind === "grid") {
      save({ name: parsed.grid, latDeg: parsed.latDeg, lonDeg: parsed.lonDeg, source: "grid" });
      return;
    }
    if (parsed.kind === "coords") {
      save({
        name: `${parsed.latDeg.toFixed(4)}, ${parsed.lonDeg.toFixed(4)}`,
        latDeg: parsed.latDeg,
        lonDeg: parsed.lonDeg,
        source: "coords",
      });
      return;
    }
    // A later choice (GPS, another search) or closing the prompt wins over
    // this answer when it comes back.
    const mine = ++attempt.current;
    // This search replaces a GPS request still waiting: stop its timer, or
    // it would report "unavailable" over this search's answer.
    stopWaiting();
    setTextBusy(true);
    const found = await geocodeOne(parsed.query);
    setTextBusy(false);
    if (attempt.current !== mine) return;
    if (found && "busy" in found) {
      setMessage("The place search is busy. Try again in a moment, or enter coordinates or a grid square.");
      return;
    }
    if (!found || !Number.isFinite(found.latDeg) || !Number.isFinite(found.lonDeg)) {
      setMessage(`No place found for "${typed}".`);
      return;
    }
    // Named as the map knows it ("nyc" saves as "New York, New York"),
    // or as typed when the lookup gives no name.
    save({ name: found.placeName || typed, latDeg: found.latDeg, lonDeg: found.lonDeg, source: "place" });
  };

  const form = (
    <form className="location-prompt__form" onSubmit={onSubmit}>
      <Field label="Place, coordinates or grid square" hideLabel>
        <input
          type="text"
          autoComplete="off"
          placeholder='Place, "lat, lon" or grid (EN52ve)'
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
        />
      </Field>
      <Button type="submit" disabled={textBusy || !text.trim()}>
        {textBusy ? "Looking..." : "Set"}
      </Button>
    </form>
  );
  const error = message && <p className="home-error" role="alert">{message}</p>;

  if (variant === "sheet") {
    return (
      <div className="location-prompt location-prompt--sheet">
        {form}
        {error}
        <Button className="location-prompt__device" disabled={gpsBusy} onClick={useDevice}>
          <span>{gpsBusy ? "Finding you..." : "Use my location"}</span>
          <span className="location-prompt__sub">Stays on this device</span>
        </Button>
      </div>
    );
  }

  return (
    <section className="location-prompt" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="heading-section">Where are you?</h2>
      <p className="note">SeekSat shows where satellites are now and when they pass over you. Your location stays on this device.</p>
      <Button variant="primary" disabled={gpsBusy} onClick={useDevice}>
        {gpsBusy ? "Finding you..." : "Use my location"}
      </Button>
      {form}
      {error}
    </section>
  );
}

// The popular set with a follow toggle, shown with the prompt so a first
// visit is never empty.
export function PopularList({ names }: { names: ReadonlyMap<number, string> }) {
  const uid = useId();
  const following = useHomeStore((s) => s.prefs.following);
  const follow = useHomeStore((s) => s.follow);
  const unfollow = useHomeStore((s) => s.unfollow);
  const full = following.length >= MAX_FOLLOWING;

  return (
    <section className="popular" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="heading-section">Popular satellites</h2>
      <ul className="popular__list">
        {POPULAR_IDS.map((id) => {
          const on = following.includes(id);
          const name = names.get(id) ?? `NORAD ${id}`;
          return (
            <li key={id} className="popular__item">
              <span>{name}</span>
              <Button
                variant="primary"
                pressed={on}
                aria-label={`Save ${name}`}
                disabled={!on && full}
                title={!on && full ? `You can save up to ${MAX_FOLLOWING} satellites` : undefined}
                onClick={() => (on ? unfollow(id) : follow(id))}
              >
                {on ? "Saved" : "Save"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
