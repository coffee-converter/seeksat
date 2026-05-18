"use client";

import { usePassFinderStore } from "@/lib/pass-finder-store";

// Visual / Radio toggle. The scene watches store.mode and re-runs the
// visibility search when it flips.
export default function ModeToggle() {
  const mode = usePassFinderStore((s) => s.mode);
  const setMode = usePassFinderStore((s) => s.setMode);

  return (
    <div id="mode-toggle" className="mode-toggle" role="group" aria-label="Pass mode">
      <button
        type="button"
        data-mode="visual"
        className={mode === "visual" ? "active" : ""}
        onClick={() => setMode("visual")}
      >
        Visual
      </button>
      <button
        type="button"
        data-mode="radio"
        className={mode === "radio" ? "active" : ""}
        onClick={() => setMode("radio")}
      >
        Radio
      </button>
    </div>
  );
}
