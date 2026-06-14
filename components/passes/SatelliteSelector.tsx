"use client";

import { useState } from "react";
import { CATALOG } from "@/lib/catalog.mjs";
import { usePassFinderStore } from "@/lib/pass-finder-store";

// Custom dropdown over the satellite catalog. Trigger shows the current
// satellite + a tier badge; the popover lists every catalog entry.
// Premium entries render disabled with a lock (dormant — none are
// premium yet). Built so a filter <input> can be added when the catalog
// grows; not added now (YAGNI).
export default function SatelliteSelector() {
  const selectedNoradId = usePassFinderStore((s) => s.selectedNoradId);
  const setSelectedSatellite = usePassFinderStore((s) => s.setSelectedSatellite);
  const [open, setOpen] = useState(false);

  const current = CATALOG.find((s) => s.noradId === selectedNoradId) ?? CATALOG[0];

  return (
    <div className="sat-selector">
      <button
        type="button"
        className="sat-selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sat-name">{current.name}</span>
        {current.tier === "premium" && <span className="sat-badge pro">PRO</span>}
        <span className="sat-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="sat-selector-list" role="listbox">
          {CATALOG.map((s) => {
            const locked = s.tier === "premium";
            return (
              <li key={s.noradId} role="option" aria-selected={s.noradId === selectedNoradId}>
                <button
                  type="button"
                  className={`sat-option${s.noradId === selectedNoradId ? " active" : ""}${locked ? " locked" : ""}`}
                  disabled={locked}
                  title={locked ? "Premium satellite — upgrade to track" : undefined}
                  onClick={() => { setSelectedSatellite(s.noradId); setOpen(false); }}
                >
                  <span className="sat-name">{s.name}</span>
                  <span className="sat-incl">{s.inclinationDeg}°</span>
                  {locked && <span className="sat-badge pro">PRO</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
