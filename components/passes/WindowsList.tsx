"use client";

import { usePassFinderStore } from "@/lib/pass-finder-store";
import { passIcsFor } from "@/lib/scene-bridge";

// Download one pass as an .ics file. The scene builds the event and
// names the file; this only hands it to the browser.
function downloadPassIcs(i: number) {
  const result = passIcsFor(i);
  if (!result) return;
  const url = URL.createObjectURL(new Blob([result.ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred revoke, as in RadioModal's CSV download (Safari drops
  // downloads whose URL is revoked in the same tick as the click).
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

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
    ? `${headers.map(() => "auto").join(" ")} auto` // + calendar button
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
          <span />
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
          <button
            type="button"
            className="ics-btn"
            aria-label="Add to calendar"
            title="Add to calendar"
            onClick={(ev) => {
              ev.stopPropagation();
              downloadPassIcs(i);
            }}
            onKeyDown={(ev) => ev.stopPropagation()}
          >
            📅
          </button>
        </div>
      ))}
    </div>
  );
}
