"use client";

import { useState } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { addObserver } from "@/lib/scene-bridge";
import { parseDmsToDecimal } from "@/lib/coords.js";
import { geocodeOne } from "@/lib/pass-finder/geocode.js";

// Single smart-input add-observer form. The text field accepts either
// a lat/lon pair (DMS or decimal, comma-separated) or a free-text
// place name. tryParseLatLon decides: a comma-split into two
// successfully-parsed DMS/decimal numbers wins, otherwise we
// geocode. Two helper buttons:
//   - "Use my location" - browser Geolocation API
//   - "Click on globe to place" - toggle the scene's click-to-place
//     mode (canvas-click handler in pass-finder-scene.js)
//
// Each path calls the typed scene-bridge addObserver, which handles
// Cesium entity creation + cloud-forecast fetch + timezone lookup +
// search rerun on the imperative side.

interface LatLon { latDeg: number; lonDeg: number; }

function tryParseLatLon(raw: string): LatLon | null {
  // Need a comma with two non-empty pieces. Without that, fall
  // through to geocode (place names rarely include a stray comma
  // followed by something that parses as a coord).
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  try {
    const latDeg = parseDmsToDecimal(parts[0]);
    const lonDeg = parseDmsToDecimal(parts[1]);
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
    return { latDeg, lonDeg };
  } catch {
    return null;
  }
}

export default function AddObserverForm() {
  const clickToPlace = usePassFinderStore((s) => s.clickToPlace);
  const setClickToPlace = usePassFinderStore((s) => s.setClickToPlace);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const submit = async () => {
    const raw = input.trim();
    if (!raw || busy) return;
    const coords = tryParseLatLon(raw);
    if (coords) {
      addObserver(null, coords.latDeg, coords.lonDeg);
      setInput("");
      return;
    }
    // Geocode the free-text query.
    setBusy(true);
    try {
      const result = await geocodeOne(raw);
      if (!result) {
        alert(`No result for "${raw}"`);
        return;
      }
      addObserver(raw, result.latDeg, result.lonDeg);
      setInput("");
    } finally {
      setBusy(false);
    }
  };

  const useMyLocation = () => {
    if (locating) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      alert("Geolocation not available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        addObserver("My location", pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        const msg = err.code === err.PERMISSION_DENIED
          ? "Location permission denied. Allow it in your browser to use this button."
          : `Couldn't get location: ${err.message}`;
        alert(msg);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <>
      <div className="add-row">
        <input
          id="add-observer-input"
          type="text"
          placeholder="lat, lon  or  place name"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
          }}
        />
        <button id="add-observer-btn" type="button" disabled={busy} onClick={submit}>
          {busy ? "Looking up…" : "Add"}
        </button>
      </div>
      <button
        id="use-my-location"
        type="button"
        className="toggle"
        disabled={locating}
        onClick={useMyLocation}
      >
        {locating ? "Locating…" : "Use my location"}
      </button>
      <button
        id="click-place-toggle"
        type="button"
        className={`toggle${clickToPlace ? " active" : ""}`}
        onClick={() => setClickToPlace(!clickToPlace)}
      >
        Click on globe to place
      </button>
    </>
  );
}
