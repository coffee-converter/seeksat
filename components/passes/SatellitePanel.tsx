"use client";

import { useEffect, useRef } from "react";
import { CATALOG } from "@/lib/catalog.mjs";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { fetchTle, parseTleEpoch } from "@/lib/pass-finder/tle.js";
import { isNewerTle } from "@/lib/pass-finder/tle-seed.js";
import SatelliteSelector from "@/components/passes/SatelliteSelector";

// Format a TLE epoch (from line1) as a relative age string.
function ageText(line1: string): string {
  const epoch = parseTleEpoch(line1);
  if (!Number.isFinite(epoch)) return "unknown";
  const hours = (Date.now() - epoch) / 3_600_000;
  if (hours < 1) return "updated <1h ago";
  if (hours < 48) return `updated ${Math.round(hours)}h ago`;
  return `updated ${Math.round(hours / 24)}d ago`;
}

// Satellite section: selector + a live readout for the selected
// satellite, and a per-selection client refresh that also drives
// clock-sync (via fetchTle → syncFromResponse). Replaces the old raw
// TLE textarea panel.
export default function SatellitePanel() {
  const selectedNoradId = usePassFinderStore((s) => s.selectedNoradId);
  const tle = usePassFinderStore((s) => s.tle);
  const tleStatus = usePassFinderStore((s) => s.tleStatus);

  const entry = CATALOG.find((s) => s.noradId === selectedNoradId) ?? CATALOG[0];
  const sourceRef = useRef<string | null>(null);

  // On every selection change: fetch the freshest elements for that
  // satellite. Apply only if strictly newer than the cached/seeded TLE
  // (epoch guard) so a stale or failed fetch never regresses the seed.
  // The fetch always runs — its clock-sync side effect is the point.
  useEffect(() => {
    let cancelled = false;
    const store = usePassFinderStore.getState();
    store.setTleStatus("fetching");
    fetchTle(selectedNoradId)
      .then((t) => {
        if (cancelled) return;
        if (!t) { store.setTleStatus("error"); return; }
        const currentLine1 = usePassFinderStore.getState().satelliteTles[selectedNoradId]?.line1 ?? "";
        if (isNewerTle(currentLine1, t.line1)) {
          const next = { name: t.name || entry.name, line1: t.line1, line2: t.line2 };
          store.setTle(next);
          store.setSatelliteTles({ ...store.satelliteTles, [selectedNoradId]: next });
        }
        sourceRef.current = t.source ?? null;
        store.setTleStatus("ready");
      })
      .catch(() => { if (!cancelled) store.setTleStatus("error"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNoradId]);

  const hasTle = tle.line1.startsWith("1 ") && tle.line2.startsWith("2 ");
  const statusText =
    tleStatus === "fetching" ? (hasTle ? "checking for newer…" : "fetching TLE…")
    : tleStatus === "error" ? "fetch failed — using cached element set."
    : "";

  return (
    <div className="satellite-panel">
      <SatelliteSelector />
      <dl className="sat-readout">
        <div><dt>NORAD</dt><dd>{entry.noradId}</dd></div>
        <div><dt>Inclination</dt><dd>{entry.inclinationDeg}°</dd></div>
        <div><dt>Elements</dt><dd>{hasTle ? ageText(tle.line1) : "—"}{sourceRef.current ? ` · ${sourceRef.current}` : ""}</dd></div>
      </dl>
      {entry.viewingHint && <p className="sat-hint">{entry.viewingHint}</p>}
      {statusText && <p className={`hint${tleStatus === "error" ? " error" : ""}`}>{statusText}</p>}
    </div>
  );
}
