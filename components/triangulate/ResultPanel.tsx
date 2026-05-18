"use client";

import { useTriangulateStore } from "@/lib/store";
import { ecefToGeodetic, geodeticToEcef } from "@/lib/coords.js";
import { useMemo } from "react";

// Read-only result panel: 4 monospaced blocks showing the triangulated
// solution, slant ranges, per-ray residuals, and TLE truth comparison
// (only when a TLE is loaded). The bootstrap (or, eventually, the
// Cesium scene hook) is responsible for writing triangulated/residuals/
// truthPos into the store; this component just renders the latest values.

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function Block({ header, lines }: { header: string; lines: string[] }) {
  return (
    <div className="result-block">
      <span className="label">{header}</span>
      {lines.map((l) => `\n${l}`).join("")}
    </div>
  );
}

export default function ResultPanel() {
  const triangulated = useTriangulateStore((s) => s.triangulated);
  const residuals = useTriangulateStore((s) => s.residuals);
  const observations = useTriangulateStore((s) => s.observations);
  const tle = useTriangulateStore((s) => s.tle);
  const truthPos = useTriangulateStore((s) => s.truthPos);

  // Derive lat/lon/alt + slant ranges + residual lines from the ECEF
  // point. Memoize so we don't redo the trig every clock tick.
  const triBlock = useMemo(() => {
    if (!triangulated) return null;
    const { latDeg, lonDeg, elevM } = ecefToGeodetic(...triangulated);
    return [
      `lat  ${latDeg.toFixed(5)}°`,
      `lon  ${lonDeg.toFixed(5)}°`,
      `alt  ${(elevM / 1000).toFixed(2)} km above WGS84`,
    ];
  }, [triangulated]);

  const slantLines = useMemo(() => {
    if (!triangulated) return [];
    return observations
      .filter((o) => o.latDeg != null && o.lonDeg != null)
      .map((obs) => {
        const o = geodeticToEcef(obs.latDeg!, obs.lonDeg!, obs.elevM ?? 0);
        const d = Math.hypot(
          triangulated[0] - o[0],
          triangulated[1] - o[1],
          triangulated[2] - o[2],
        );
        return `${pad(obs.name, 10)} ${(d / 1000).toFixed(2)} km`;
      });
  }, [triangulated, observations]);

  const residualLines = useMemo(() => {
    return residuals.map((r, i) => {
      const name = observations[i]?.name ?? `Obs ${i}`;
      return `${pad(name, 10)} ${(r / 1000).toFixed(3)} km`;
    });
  }, [residuals, observations]);

  const truthBlock = useMemo(() => {
    if (!truthPos) return null;
    const { latDeg, lonDeg, elevM } = ecefToGeodetic(...truthPos);
    const lines = [
      `lat  ${latDeg.toFixed(5)}°`,
      `lon  ${lonDeg.toFixed(5)}°`,
      `alt  ${(elevM / 1000).toFixed(2)} km`,
    ];
    if (triangulated) {
      const miss = Math.hypot(
        truthPos[0] - triangulated[0],
        truthPos[1] - triangulated[1],
        truthPos[2] - triangulated[2],
      );
      lines.push(`Δ    ${(miss / 1000).toFixed(2)} km`);
    }
    const name = tle.name?.trim() || "TLE";
    return { header: `TLE: ${name}`, lines };
  }, [truthPos, triangulated, tle.name]);

  if (!triBlock) {
    return (
      <>
        <div className="result-block">Need &gt;= 2 valid observations.</div>
        <div className="result-block" />
        <div className="result-block" />
        {truthBlock && <Block header={truthBlock.header} lines={truthBlock.lines} />}
      </>
    );
  }

  return (
    <>
      <Block header="Triangulated" lines={triBlock} />
      <Block header="Slant range" lines={slantLines} />
      <Block header="Per-ray residuals" lines={residualLines} />
      {truthBlock && <Block header={truthBlock.header} lines={truthBlock.lines} />}
    </>
  );
}
