"use client";

import { useEffect, useRef } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { fetchIssTle } from "@/lib/pass-finder/tle.js";

// TLE editor for the pass-finder page. Auto-fetches the current ISS
// TLE on first mount; subsequent edits + refetch land in the store
// (pass-finder-scene subscribes for refreshSatrec / orbit cache
// invalidation).
export default function TlePanel() {
  const tle = usePassFinderStore((s) => s.tle);
  const tleStatus = usePassFinderStore((s) => s.tleStatus);
  const setTle = usePassFinderStore((s) => s.setTle);
  const setTleStatus = usePassFinderStore((s) => s.setTleStatus);
  // Strict-mode-safe one-shot: a ref guards against the dev-mode
  // double-invoke so we don't double-fetch on mount.
  const didFetchRef = useRef(false);
  const lastFetchedRef = useRef<string | null>(null);

  const doFetch = async () => {
    setTleStatus("fetching");
    try {
      const t = await fetchIssTle();
      if (t) {
        setTle({ name: t.name, line1: t.line1, line2: t.line2 });
        setTleStatus("ready");
        lastFetchedRef.current = new Date().toUTCString();
      } else {
        setTleStatus("error");
      }
    } catch {
      setTleStatus("error");
    }
  };

  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    doFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusText =
    tleStatus === "fetching" ? "fetching from Celestrak…"
    : tleStatus === "ready" ? `fetched ${lastFetchedRef.current ?? "recently"}`
    : tleStatus === "error" ? "fetch failed — paste a TLE below."
    : "";
  const statusClass = `hint${tleStatus === "ready" ? " ok" : tleStatus === "error" ? " error" : ""}`;

  return (
    <>
      <div id="tle-status" className={statusClass}>{statusText}</div>
      <textarea
        id="tle-name"
        placeholder="ISS (ZARYA)"
        value={tle.name}
        onChange={(e) => setTle({ name: e.target.value })}
      />
      <textarea
        id="tle-l1"
        placeholder="1 25544U ..."
        value={tle.line1}
        onChange={(e) => setTle({ line1: e.target.value })}
      />
      <textarea
        id="tle-l2"
        placeholder="2 25544 ..."
        value={tle.line2}
        onChange={(e) => setTle({ line2: e.target.value })}
      />
      <button id="tle-refetch" type="button" onClick={doFetch}>
        Refetch from Celestrak
      </button>
    </>
  );
}
