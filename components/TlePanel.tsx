"use client";

import { useState } from "react";
import { useTriangulateStore } from "@/lib/store";
import { fetchIssTle } from "@/lib/pass-finder/tle.js";

// TLE panel — three textareas (name + line1 + line2), Fetch / Clear
// buttons, and a stale-warn line. Mirrors the legacy panel's behavior
// faithfully (same widget layout, same "fetched TLE won't match a
// >24h-old attempt" warning) but reads/writes through the Zustand
// store instead of imperative DOM mutation. Uses lib/pass-finder/tle
// so the fetch picks up the ivanstanojevic-then-Celestrak fallback we
// added for pass-finder — Celestrak alone often times out from the
// browser origin.
export default function TlePanel() {
  const tle = useTriangulateStore((s) => s.tle);
  const timestampUTC = useTriangulateStore((s) => s.timestampUTC);
  const setTle = useTriangulateStore((s) => s.setTle);
  const clearTle = useTriangulateStore((s) => s.clearTle);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const hasContent = !!(
    tle.name.trim() || tle.line1.trim() || tle.line2.trim()
  );
  const tsMs = Date.parse(timestampUTC);
  const ageHours = Number.isFinite(tsMs)
    ? (Date.now() - tsMs) / 3_600_000
    : 0;
  const showStaleWarn = !hasContent && ageHours > 24;

  const onFetch = async () => {
    if (fetching || hasContent) return;
    setFetching(true);
    setFetchError(null);
    try {
      const t = await fetchIssTle();
      if (!t) throw new Error("All TLE sources failed");
      setTle({ name: t.name, line1: t.line1, line2: t.line2 });
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  };

  return (
    <details id="tle-section" open>
      <summary>
        <h2>TLE</h2>
      </summary>
      <div className="tle-actions">
        <button
          id="tle-fetch"
          type="button"
          disabled={fetching || hasContent}
          title={
            hasContent
              ? "Clear TLE fields first to refetch"
              : "Fetch the current ISS TLE (ivanstanojevic / Celestrak)"
          }
          onClick={onFetch}
        >
          {fetching ? "Fetching…" : "Fetch latest"}
        </button>
        <button
          id="tle-clear"
          type="button"
          disabled={!hasContent}
          title="Clear all three TLE fields"
          onClick={() => {
            clearTle();
            setFetchError(null);
          }}
        >
          Clear
        </button>
        {showStaleWarn && (
          <span id="tle-warn" className="hint">
            ⚠ {Math.round(ageHours)}h ago — current TLE won&apos;t match
          </span>
        )}
        {fetchError && (
          <span className="hint" style={{ color: "#f87171" }}>
            {fetchError}
          </span>
        )}
      </div>
      <textarea
        id="tle-line1"
        placeholder="ISS (ZARYA)"
        value={tle.name}
        onChange={(e) => setTle({ name: e.target.value })}
      />
      <textarea
        id="tle-line2"
        placeholder="1 25544U ..."
        value={tle.line1}
        onChange={(e) => setTle({ line1: e.target.value })}
      />
      <textarea
        id="tle-line3"
        placeholder="2 25544 ..."
        value={tle.line2}
        onChange={(e) => setTle({ line2: e.target.value })}
      />
    </details>
  );
}
