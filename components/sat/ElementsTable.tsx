"use client";

import { formatNumber, periodText } from "@/lib/sat/numbers.mjs";
import { isoUtc, type Elements } from "./LiveNumbers";

type Age = { text: string; level: string };

/** "Elements are 2.3 days old, from CelesTrak, fetched 5 min ago." with its badge. */
export function AgeLine({ age, source, fetchedText }: { age: Age; source: string; fetchedText: string | null }) {
  return (
    <p className="home-note sat-age">
      {`${age.text}, from ${source}`}
      {fetchedText ? `, ${fetchedText}.` : "."}
      {age.level === "old" ? <span className="sat-badge sat-badge--old">old elements</span> : null}
      {age.level === "stale" ? (
        <span className="sat-badge sat-badge--stale">stale elements: positions may be far off</span>
      ) : null}
    </p>
  );
}

/** Element age with its badge, then the mean elements in a compact table. */
export default function ElementsTable({
  elements, age, source, fetchedText, epochMs,
}: {
  elements: Elements;
  age: Age;
  source: string;
  /** "fetched 5 min ago", or null when unknown. */
  fetchedText: string | null;
  epochMs: number | null;
}) {
  const ecc = elements.eccentricity;
  const rows: Array<[string, string]> = [
    ["Perigee", `${formatNumber(elements.perigeeAltKm, 0)} km`],
    ["Apogee", `${formatNumber(elements.apogeeAltKm, 0)} km`],
    ["Period", periodText(elements.periodMin)],
    ["Inclination", `${formatNumber(elements.inclinationDeg, 2)}°`],
    ["Eccentricity", formatNumber(ecc, ecc < 0.01 ? 7 : 4)],
    ["Semi-major axis", `${formatNumber(elements.semiMajorAxisKm, 1)} km`],
  ];
  return (
    <section className="sat-elements" aria-labelledby="sat-elements-title">
      <h2 id="sat-elements-title" className="home-heading">Mean elements</h2>
      <AgeLine age={age} source={source} fetchedText={fetchedText} />
      <dl className="sat-etable">
        {rows.map(([k, v]) => (
          <div key={k} className="sat-etable__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {epochMs != null ? (
          <div className="sat-etable__row sat-etable__row--wide">
            <dt>Epoch</dt>
            <dd>{isoUtc(epochMs)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
