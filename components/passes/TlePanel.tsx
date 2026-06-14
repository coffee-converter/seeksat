"use client";

import { useEffect, useRef } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { fetchIssTle } from "@/lib/pass-finder/tle.js";
import { isNewerTle } from "@/lib/pass-finder/tle-seed.js";

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
  const userEditedRef = useRef(false);

  // isManual=true (the Refresh button) bypasses the guards: an explicit
  // user refresh always applies the fetched TLE. The automatic mount
  // fetch (isManual=false) applies its result only when the user hasn't
  // manually edited AND the fetched epoch is strictly newer than what's
  // in the store (so it can't regress a newer server seed). The fetch
  // itself — and its clock-sync side effect inside fetchIssTle — always
  // runs regardless of whether the result is applied.
  const doFetch = async (isManual = false) => {
    setTleStatus("fetching");
    try {
      const t = await fetchIssTle();
      if (t) {
        const currentLine1 = usePassFinderStore.getState().tle.line1;
        const blockedByEdit = userEditedRef.current && !isManual;
        const apply = isManual || (!blockedByEdit && isNewerTle(currentLine1, t.line1));
        if (apply) {
          setTle({ name: t.name, line1: t.line1, line2: t.line2 });
          lastFetchedRef.current = new Date().toUTCString();
        }
        setTleStatus("ready");
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

  const hasValidTle = tle.line1.startsWith("1 ") && tle.line2.startsWith("2 ");
  const statusText =
    tleStatus === "fetching" ? (hasValidTle ? "checking for newer…" : "fetching latest TLE…")
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
        onChange={(e) => { userEditedRef.current = true; setTle({ name: e.target.value }); }}
      />
      <textarea
        id="tle-l1"
        placeholder="1 25544U ..."
        value={tle.line1}
        onChange={(e) => { userEditedRef.current = true; setTle({ line1: e.target.value }); }}
      />
      <textarea
        id="tle-l2"
        placeholder="2 25544 ..."
        value={tle.line2}
        onChange={(e) => { userEditedRef.current = true; setTle({ line2: e.target.value }); }}
      />
      <button id="tle-refetch" type="button" onClick={() => doFetch(true)} title="Pull a fresh TLE for the ISS">
        Refresh
      </button>
    </>
  );
}
