"use client";

import Link from "next/link";
import "@/app/home.css";
import { formatNumber } from "@/lib/sat/numbers.mjs";
import type { satPageData } from "@/lib/sat/page-data.mjs";

export type SatPageData = ReturnType<typeof satPageData>;

// Static version: renders deterministically from `data` (no clock, no locale
// formatting). The live version replaces the numbers in a later task.
export default function SatApp({ data }: { data: SatPageData }) {
  const { elements, live, raw } = data;
  const rows: Array<[string, string]> = [];
  if (elements) {
    rows.push(
      ["Perigee altitude", `${formatNumber(elements.perigeeAltKm, 0)} km`],
      ["Apogee altitude", `${formatNumber(elements.apogeeAltKm, 0)} km`],
      ["Period", `${formatNumber(elements.periodMin, 1)} min`],
      ["Inclination", `${formatNumber(elements.inclinationDeg, 2)}°`],
      ["Eccentricity", formatNumber(elements.eccentricity, 5)],
      ["Semi-major axis", `${formatNumber(elements.semiMajorAxisKm, 0)} km`],
    );
  }
  if (live) {
    rows.push(
      ["Altitude above ellipsoid", `${formatNumber(live.altitudeKm, 0)} km`],
      ["Distance from Earth's center", `${formatNumber(live.radiusKm, 0)} km`],
      ["Speed (inertial)", `${formatNumber(live.speedKmS, 2)} km/s`],
      ["Ground speed", `${formatNumber(live.groundSpeedKmS, 2)} km/s`],
      ["Latitude", `${formatNumber(live.latDeg, 2)}°`],
      ["Longitude", `${formatNumber(live.lonDeg, 2)}°`],
    );
  }
  return (
    <main className="home">
      <Link className="home-wordmark" href="/">SeekSat</Link>
      <h1 className="home-heading">{data.name}</h1>
      <p className="home-note">
        {`NORAD ${data.noradId}`}
        {data.intlDesignator ? ` · ${data.intlDesignator}` : ""}
      </p>
      {data.note ? <p className="home-note">{data.note}</p> : null}
      <p className="home-note">{data.age.text}. Source: {data.source}.</p>
      {rows.length ? (
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="home-note">These elements can&apos;t be propagated, so there is no live position.</p>
      )}
      {raw.threeLine ? <pre style={{ overflowX: "auto" }}>{raw.threeLine}</pre> : null}
      {raw.tooBigForTle ? (
        <p className="home-note">This catalog number is too large for the two-line (TLE) format.</p>
      ) : null}
      {raw.omm ? <pre style={{ overflowX: "auto" }}>{raw.omm}</pre> : null}
    </main>
  );
}
