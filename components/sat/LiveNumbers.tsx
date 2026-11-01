"use client";

import { HOW_WE_COMPUTE, formatNumber } from "@/lib/sat/numbers.mjs";
import type { SatPageData } from "./SatApp";

type Live = NonNullable<SatPageData["live"]>;
type Elements = NonNullable<SatPageData["elements"]>;

function Row({ label, value, how }: { label: string; value: string; how?: string }) {
  return (
    <div className="sat-row">
      <dt>{label}</dt>
      <dd>
        {value}
        {how ? <small className="sat-how">{how}</small> : null}
      </dd>
    </div>
  );
}

export function isoUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}

export default function LiveNumbers({
  live, elements, epochMs,
}: { live: Live; elements: Elements; epochMs: number | null }) {
  const period = elements.periodMin;
  const periodText = `${formatNumber(period, 2)} min` +
    (period > 600 ? ` (${Math.floor(period / 60)} h ${formatNumber(Math.round(period % 60), 0)} min)` : "");
  const ecc = elements.eccentricity;
  return (
    <div className="sat-numbers">
      <h2 className="home-heading">Right now</h2>
      <dl className="sat-dl">
        <Row label="Inertial speed" value={`${formatNumber(live.speedKmS, 3)} km/s`} how={HOW_WE_COMPUTE.speed} />
        <Row label="Ground speed" value={`${formatNumber(live.groundSpeedKmS, 3)} km/s`} how={HOW_WE_COMPUTE.groundSpeed} />
        <Row label="Altitude" value={`${formatNumber(live.altitudeKm, 1)} km`} how={HOW_WE_COMPUTE.altitude} />
        <Row label="Distance from Earth's center" value={`${formatNumber(live.radiusKm, 1)} km`} how={HOW_WE_COMPUTE.radius} />
        <Row label="v²r/GM" value={formatNumber(live.v2rOverGM, 4)} how={HOW_WE_COMPUTE.visViva} />
        <Row label="2 − r/a" value={formatNumber(live.visViva, 4)} />
      </dl>
      <h2 className="home-heading">Mean elements</h2>
      <dl className="sat-dl">
        <Row label="Perigee" value={`${formatNumber(elements.perigeeAltKm, 0)} km`} />
        <Row label="Apogee" value={`${formatNumber(elements.apogeeAltKm, 0)} km`} />
        <Row label="Eccentricity" value={formatNumber(ecc, ecc < 0.01 ? 7 : 4)} />
        <Row label="Period" value={periodText} />
        <Row label="Inclination" value={`${formatNumber(elements.inclinationDeg, 2)}°`} />
        <Row label="Semi-major axis" value={`${formatNumber(elements.semiMajorAxisKm, 1)} km`} />
      </dl>
      <p className="sat-how">{HOW_WE_COMPUTE.elements}</p>
      {epochMs != null ? (
        <dl className="sat-dl">
          <Row label="Epoch" value={isoUtc(epochMs)} how={HOW_WE_COMPUTE.epoch} />
        </dl>
      ) : null}
    </div>
  );
}
