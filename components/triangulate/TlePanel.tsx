"use client";

import { useState } from "react";
import { useTriangulateStore } from "@/lib/store";
import { tleHasContent } from "@/lib/tle-utils";
import { fetchIssTle } from "@/lib/pass-finder/tle.js";

// Controlled TLE form: three textareas + Fetch / Clear + stale-warn
// hint. State lives in the Zustand store; the bootstrap subscribes to
// store.tle changes and re-runs its truth-rendering chain.
export default function TlePanel() {
  const tle = useTriangulateStore((s) => s.tle);
  const timestampUTC = useTriangulateStore((s) => s.timestampUTC);
  const setTle = useTriangulateStore((s) => s.setTle);
  const clearTle = useTriangulateStore((s) => s.clearTle);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const hasContent = tleHasContent(tle);

  // The TLE fetch helpers only serve the *current* TLE - warn when
  // the loaded attempt is from more than a day ago, since a freshly-
  // fetched TLE won't match the past pass.
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
    <>
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
            ⚠ {Math.round(ageHours)}h ago - current TLE won&apos;t match
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
    </>
  );
}
