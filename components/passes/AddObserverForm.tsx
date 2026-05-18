"use client";

import { useState } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { parseDmsToDecimal } from "@/lib/coords.js";
import { geocodeOne } from "@/lib/pass-finder/geocode.js";

// Three add-observer controls: lat/lon input, geocode input, click-
// to-place toggle. Each dispatches a `passes-add-observer` CustomEvent
// with { name, latDeg, lonDeg } that the bootstrap listens for to do
// the actual Cesium entity creation + cloud forecast fetch + search
// rerun (those side effects haven't migrated yet — they will when the
// observer list itself becomes React).
function dispatchAdd(name: string | null, latDeg: number, lonDeg: number) {
  window.dispatchEvent(
    new CustomEvent("passes-add-observer", {
      detail: { name, latDeg, lonDeg },
    }),
  );
}

export default function AddObserverForm() {
  const clickToPlace = usePassFinderStore((s) => s.clickToPlace);
  const setClickToPlace = usePassFinderStore((s) => s.setClickToPlace);
  const [latlon, setLatlon] = useState("");
  const [place, setPlace] = useState("");
  const [geocoding, setGeocoding] = useState(false);

  const submitLatlon = () => {
    const raw = latlon.trim();
    if (!raw) return;
    const parts = raw.split(",");
    if (parts.length !== 2) {
      alert("Format: lat, lon (DMS or decimal)");
      return;
    }
    try {
      const latDeg = parseDmsToDecimal(parts[0].trim());
      const lonDeg = parseDmsToDecimal(parts[1].trim());
      dispatchAdd(null, latDeg, lonDeg);
      setLatlon("");
    } catch (e) {
      alert(`Bad lat/lon: ${e instanceof Error ? e.message : e}`);
    }
  };

  const submitGeocode = async () => {
    const q = place.trim();
    if (!q || geocoding) return;
    setGeocoding(true);
    try {
      const result = await geocodeOne(q);
      if (!result) {
        alert(`No result for "${q}"`);
        return;
      }
      dispatchAdd(q, result.latDeg, result.lonDeg);
      setPlace("");
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <>
      <div className="add-row">
        <input
          id="add-latlon"
          type="text"
          placeholder={`lat, lon (e.g. 40°30'30.0"N, 75°15'45.0"W)`}
          value={latlon}
          onChange={(e) => setLatlon(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submitLatlon(); }
          }}
        />
        <button id="add-latlon-btn" type="button" onClick={submitLatlon}>
          Add
        </button>
      </div>
      <div className="add-row">
        <input
          id="add-geocode"
          type="text"
          placeholder="place name (e.g. Brookfield, WI)"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submitGeocode(); }
          }}
        />
        <button
          id="add-geocode-btn"
          type="button"
          disabled={geocoding}
          onClick={submitGeocode}
        >
          {geocoding ? "Geocoding…" : "Geocode"}
        </button>
      </div>
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
