"use client";

import { useId, useState } from "react";
import { parseLocationInput } from "@/lib/location/maidenhead.mjs";
import { geocodeOne } from "@/lib/pass-finder/geocode.js";
import { MAX_FOLLOWING, POPULAR_IDS } from "@/lib/home/prefs.mjs";
import { useHomeStore, type HomeLocation } from "@/lib/home/store";

const DENIED = "Location access was denied. Type a place or grid square instead.";
const UNAVAILABLE = "Your location isn't available right now. Type a place or grid square instead.";
const UNSUPPORTED = "This browser can't share its location. Type a place or grid square instead.";

interface Props {
  /** Called once a location is saved. */
  onDone?: () => void;
  /** Shows a Cancel button (when changing an existing location). */
  onCancel?: () => void;
}

// Where the cards are computed from: the device's position, or a place,
// "lat, lon" or grid square typed in. Saves to prefs with its source.
export default function LocationPrompt({ onDone, onCancel }: Props) {
  const uid = useId();
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"gps" | "text" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = (location: HomeLocation) => {
    setPrefs({ location });
    setMessage(null);
    onDone?.();
  };

  const useDevice = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMessage(UNSUPPORTED);
      return;
    }
    setBusy("gps");
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        save({
          name: "My location",
          latDeg: pos.coords.latitude,
          lonDeg: pos.coords.longitude,
          source: "gps",
        });
      },
      (err) => {
        setBusy(null);
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
    setBusy("text");
    const found = await geocodeOne(parsed.query);
    setBusy(null);
    if (!found || !Number.isFinite(found.latDeg) || !Number.isFinite(found.lonDeg)) {
      setMessage(`No place found for "${typed}".`);
      return;
    }
    save({ name: typed, latDeg: found.latDeg, lonDeg: found.lonDeg, source: "place" });
  };

  return (
    <section className="location-prompt" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="home-heading">Where are you?</h2>
      <p className="location-prompt__hint">Passes are worked out for your location. It stays on this device.</p>
      <button
        type="button"
        className="home-button home-button--primary"
        disabled={busy !== null}
        onClick={useDevice}
      >
        {busy === "gps" ? "Finding you..." : "Use my location"}
      </button>
      <form className="location-prompt__form" onSubmit={onSubmit}>
        <label htmlFor={`${uid}-place`} className="sr-only">Place, coordinates or grid square</label>
        <input
          id={`${uid}-place`}
          className="home-input"
          type="text"
          autoComplete="off"
          placeholder='Place, "lat, lon" or grid square (EN52ve)'
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
        />
        <button type="submit" className="home-button" disabled={busy !== null || !text.trim()}>
          {busy === "text" ? "Looking..." : "Set"}
        </button>
      </form>
      {message && <p className="home-error" role="alert">{message}</p>}
      {onCancel && (
        <button type="button" className="home-link" onClick={onCancel}>
          Cancel
        </button>
      )}
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
      <h2 id={`${uid}-title`} className="home-heading">Popular satellites</h2>
      <ul className="popular__list">
        {POPULAR_IDS.map((id) => {
          const on = following.includes(id);
          const name = names.get(id) ?? `NORAD ${id}`;
          return (
            <li key={id} className="popular__item">
              <span>{name}</span>
              <button
                type="button"
                className="home-chip"
                aria-pressed={on}
                aria-label={`Follow ${name}`}
                disabled={!on && full}
                title={!on && full ? `You can follow up to ${MAX_FOLLOWING} satellites` : undefined}
                onClick={() => (on ? unfollow(id) : follow(id))}
              >
                {on ? "Following" : "Follow"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
