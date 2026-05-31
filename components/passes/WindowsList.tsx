"use client";

import { usePassFinderStore } from "@/lib/pass-finder-store";

// Renders the pre-computed window display rows from the store. All
// the rating / formatting / coloring math lives in the scene
// (lib/pass-finder-scene.js); this component is pure presentation.
// Row clicks set activeWindowIdx in the store; the scene subscribes
// and runs jumpToWindow (camera + clock + entity reframing).
export default function WindowsList() {
  const headers = usePassFinderStore((s) => s.windowHeaders);
  const rows = usePassFinderStore((s) => s.windowRows);
  const status = usePassFinderStore((s) => s.windowsStatus);
  const activeIdx = usePassFinderStore((s) => s.activeWindowIdx);
  const selectWindow = usePassFinderStore((s) => s.selectWindow);

  const gridTemplate = headers.length
    ? headers.map(() => "auto").join(" ")
    : undefined;

  return (
    <div
      id="windows-list"
      className="result-block"
      style={gridTemplate ? { gridTemplateColumns: gridTemplate } : undefined}
    >
      {headers.length > 0 && (
        <div className="window-row header">
          {headers.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
      )}
      {status === "loading" && (
        <div className="window-empty">loading…</div>
      )}
      {status === "searching" && (
        <div className="window-empty">searching…</div>
      )}
      {status === "no-observers" && (
        <div className="window-empty">add an observer to begin</div>
      )}
      {status === "empty" && (
        <div className="window-empty">no simultaneous passes found</div>
      )}
      {status === "ready" && rows.map((row, i) => (
        <div
          key={`${row.startMs}-${i}`}
          className={`window-row${i === activeIdx ? " active" : ""}`}
          role="button"
          tabIndex={0}
          aria-current={i === activeIdx ? "true" : undefined}
          onClick={() => selectWindow(i)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              selectWindow(i);
            }
          }}
        >
          {row.cells.map((cell, ci) => (
            <span
              key={ci}
              className={`${cell.className}${cell.na ? " na" : ""}`}
              style={cell.color ? { color: cell.color } : undefined}
              title={cell.title}
            >
              {cell.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
