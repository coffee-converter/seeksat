"use client";

import { useCallback } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { renderRadioModal, copyPolarPng, radioPassCsvFor, setObserverElevM } from "@/lib/scene-bridge";
import { CATALOG } from "@/lib/catalog.mjs";
import RadioChartModalView from "./RadioChartModalView";

// Find observer name from id without subscribing to the entire
// observers slice (we only need the name when the modal is visible,
// and even then it's a one-shot read for the dialog label).
function useObserverName(obsId: string | null): string | undefined {
  return usePassFinderStore((s) =>
    obsId ? s.observers.find((o) => o.id === obsId)?.name : undefined,
  );
}

// Elevation + its provenance (spec §12), read the same way as the name -
// two separate primitive selectors (not one object-returning selector) so
// an unrelated store update doesn't look like a change to Zustand's
// default reference-equality check.
function useObserverElevM(obsId: string | null): number | undefined {
  return usePassFinderStore((s) =>
    obsId ? s.observers.find((o) => o.id === obsId)?.elevM : undefined,
  );
}
function useObserverElevSource(obsId: string | null): string | undefined {
  return usePassFinderStore((s) =>
    obsId ? s.observers.find((o) => o.id === obsId)?.elevSource : undefined,
  );
}

// Fullscreen radio-pass modal for the 3D scene. RadioChartModalView owns
// the chrome and lifecycle; this wires it to the store (which observer
// is open, the frequency, the elevation override) and to the scene
// bridge, whose renderRadioModal does the imperative SVG paint and
// returns the blob URL. Copy and CSV go through scene-exposed helpers.
export default function RadioModal() {
  const obsId = usePassFinderStore((s) => s.radioModalObsId);
  const setObsId = usePassFinderStore((s) => s.setRadioModalObsId);
  // The other half of the pair: this chart says what to tune, the sky
  // chart says where to point. Ungated - reaching this modal at all
  // already means radio mode.
  const setPolarModalObsId = usePassFinderStore((s) => s.setPolarModalObsId);
  const obsName = useObserverName(obsId);
  const elevM = useObserverElevM(obsId);
  const elevSource = useObserverElevSource(obsId);

  // Frequency picker (spec §15): a known downlink from the catalog, or
  // a custom frequency typed in. Empty options + no custom frequency
  // means the sampler returns dopplerHz: null for every sample and the
  // painter skips the Doppler polyline - the other two panels still draw.
  const selectedNoradId = usePassFinderStore((s) => s.selectedNoradId);
  // The chart draws a band from this, so it belongs in the repaint deps
  // even though a full-screen overlay means it cannot change while open.
  const minElevDeg = usePassFinderStore((s) => s.minElevDeg);
  const downlinkHz = usePassFinderStore((s) => s.downlinkHz);
  const setDownlinkHz = usePassFinderStore((s) => s.setDownlinkHz);
  const entry = CATALOG.find((s) => s.noradId === selectedNoradId);
  const options = entry?.downlinks ?? [];

  // The scene reads the frequency, elevation, threshold and satellite
  // from its own state, so they are not arguments; they are deps so a
  // change to any of them hands the view a new function, which repaints.
  const render = useCallback(
    (svg: SVGSVGElement) => (obsId ? renderRadioModal(svg, obsId) : Promise.resolve(null)),
    [obsId, downlinkHz, elevM, minElevDeg, selectedNoradId],
  );
  const onClose = useCallback(() => setObsId(null), [setObsId]);
  const csv = () => (obsId ? radioPassCsvFor(obsId) : null);

  // Swap to the sky chart. Both modals are full-screen overlays, so this
  // closes ours rather than stacking one on top of the other.
  const toPolar = () => {
    if (!obsId) return;
    setPolarModalObsId(obsId);
    setObsId(null);
  };

  return (
    <RadioChartModalView
      open={!!obsId}
      subjectKey={obsId ?? ""}
      title={obsName ? `Radio pass — ${obsName}` : "Radio pass chart"}
      render={render}
      csv={csv}
      freqHz={downlinkHz}
      downlinks={options}
      onFreqChange={setDownlinkHz}
      onClose={onClose}
      copy={copyPolarPng}
      onSkyChart={toPolar}
      extraControls={
        /* Manual elevation override (spec §12): the chart's methods
           section shows elevM + elevSource (lookup/default/user); this
           is the "user" input. Committing a value repaints the chart
           the same way the frequency picker does, via the elevM
           dependency on `render` above. */
        <label className="radio-field">
          <span>Elevation</span>
          <input
            className="radio-elev-input"
            type="number"
            step="1"
            placeholder="0"
            defaultValue={elevM ?? ""}
            key={`${obsId ?? ""}-${elevSource ?? ""}`}
            aria-label="Observer elevation in metres above the WGS-84 ellipsoid"
            title={`Elevation used: ${elevM ?? 0} m (${elevSource ?? "unknown"}) `
              + `- WGS-84 ellipsoidal height`}
            onBlur={(ev) => {
              if (!obsId) return;
              const m = Number(ev.target.value);
              if (Number.isFinite(m)) setObserverElevM(obsId, m);
            }}
          />
          <span>m</span>
        </label>
      }
    />
  );
}
