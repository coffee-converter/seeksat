"use client";

import { useId, useState } from "react";
import { parseLocationInput } from "@/lib/location/maidenhead.mjs";
import { geocodeOne } from "@/lib/pass-finder/geocode.js";
import { useHomeStore, type ExtraObserver } from "@/lib/home/store";

interface Props {
  /** A shared view: show these places, with no way to add or remove one. */
  readOnly?: boolean;
  /** The places to show; defaults to the saved ones. */
  observers?: ExtraObserver[];
}

// Up to 3 other places, saved on this device. The pass list then shows only
// the times when every place can see the satellite.
export default function ExtraObservers({ readOnly = false, observers: given }: Props = {}) {
  const uid = useId();
  const saved = useHomeStore((s) => s.prefs.observers);
  const observers = given ?? saved;
  const addObserver = useHomeStore((s) => s.addObserver);
  const removeObserver = useHomeStore((s) => s.removeObserver);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = (loc: { name: string; latDeg: number; lonDeg: number }) => {
    const r = addObserver(loc);
    if (r.ok) {
      setText("");
      setMessage(null);
    } else {
      setMessage(r.message);
    }
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
      save({ name: parsed.grid, latDeg: parsed.latDeg, lonDeg: parsed.lonDeg });
      return;
    }
    if (parsed.kind === "coords") {
      save({
        name: `${parsed.latDeg.toFixed(2)}, ${parsed.lonDeg.toFixed(2)}`,
        latDeg: parsed.latDeg,
        lonDeg: parsed.lonDeg,
      });
      return;
    }
    setBusy(true);
    const found = await geocodeOne(parsed.query);
    setBusy(false);
    if (!found || !Number.isFinite(found.latDeg) || !Number.isFinite(found.lonDeg)) {
      setMessage(`No place found for "${typed}".`);
      return;
    }
    const name = (found.displayName ?? "").split(",")[0].trim() || typed;
    save({ name, latDeg: found.latDeg, lonDeg: found.lonDeg });
  };

  if (readOnly && observers.length === 0) return null;

  return (
    <div className="sat-observers" role="group" aria-labelledby={`${uid}-title`}>
      <h3 id={`${uid}-title`} className="sat-observers__title">Also seen from</h3>
      {!readOnly && <p className="home-note">Add other places to see only the times when every place can see it.</p>}
      {observers.length > 0 && (
        <ul className="sat-observers__list">
          {observers.map((o) => (
            <li key={o.id} className="sat-observers__item">
              <span>{o.name || `${o.latDeg.toFixed(2)}, ${o.lonDeg.toFixed(2)}`}</span>
              {!readOnly && <button
                type="button"
                className="home-chip"
                aria-label={`Remove ${o.name}`}
                onClick={() => removeObserver(o.id)}
              >
                {"×"}
              </button>}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && <form className="location-prompt__form" onSubmit={onSubmit}>
        <label htmlFor={`${uid}-place`} className="sr-only">Place, coordinates or grid square</label>
        <input
          id={`${uid}-place`}
          className="home-input"
          type="text"
          autoComplete="off"
          placeholder='Place, "lat, lon" or grid'
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
        />
        <button type="submit" className="home-button" disabled={busy || !text.trim()}>
          {busy ? "Looking..." : "Add"}
        </button>
      </form>}
      {message && <p className="home-error" role="alert">{message}</p>}
    </div>
  );
}
