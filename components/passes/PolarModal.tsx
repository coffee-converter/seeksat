"use client";

import { useCallback } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { renderPolarModal, copyPolarPng } from "@/lib/scene-bridge";
import SkyChartModalView from "./SkyChartModalView";

// Find observer name from id without subscribing to the entire
// observers slice (we only need the name when the modal is visible,
// and even then it's a one-shot read for the dialog label).
function useObserverName(obsId: string | null): string | undefined {
  return usePassFinderStore((s) =>
    obsId ? s.observers.find((o) => o.id === obsId)?.name : undefined,
  );
}

// Fullscreen polar-plot modal for the 3D scene. SkyChartModalView owns
// the chrome and lifecycle; this wires it to the store (which observer
// is open) and to the scene bridge, whose renderPolarModal does the
// imperative SVG paint and returns the blob URL. Copy goes through the
// scene-exposed helper.
export default function PolarModal() {
  const obsId = usePassFinderStore((s) => s.polarModalObsId);
  const setObsId = usePassFinderStore((s) => s.setPolarModalObsId);
  // Cross-link to the radio chart for the same observer. Gated on radio
  // mode for two reasons: it matches the observer card's own gating, and
  // in visual mode the pass windows behind it are illumination-gated, so
  // renderRadioModal would have no radio series to draw.
  const mode = usePassFinderStore((s) => s.mode);
  const setRadioModalObsId = usePassFinderStore((s) => s.setRadioModalObsId);
  const obsName = useObserverName(obsId);

  // A new function per observer, so the view repaints only when the
  // observer changes; subjectKey keeps it hidden until that paint is ready.
  const render = useCallback(
    (svg: SVGSVGElement) => (obsId ? renderPolarModal(svg, obsId) : Promise.resolve(null)),
    [obsId],
  );
  const onClose = useCallback(() => setObsId(null), [setObsId]);

  // Swap to the radio chart. Both modals are full-screen overlays, so
  // this closes ours rather than stacking one on top of the other.
  const toRadio = () => {
    if (!obsId) return;
    setRadioModalObsId(obsId);
    setObsId(null);
  };

  return (
    <SkyChartModalView
      open={!!obsId}
      subjectKey={obsId ?? ""}
      title={obsName ? `Sky chart - ${obsName}` : "Pass sky chart"}
      render={render}
      onClose={onClose}
      copy={copyPolarPng}
      onRadioChart={mode === "radio" ? toRadio : undefined}
    />
  );
}
