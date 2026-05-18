"use client";

import { useEffect, useState } from "react";
import { useTriangulateStore, loadUserAttempts } from "./store";
import {
  loadManifestAttempts,
  fetchAttemptData,
  pickInitialAttemptId,
} from "./triangulate-attempts";

// One-shot boot: load the manifest, merge with user attempts, pick
// the initial one (from URL hash or first), fetch its data, seed the
// store. Returns whether boot is complete so callers can gate UI.
//
// The hook fires once per mount. Re-entry is suppressed by an internal
// flag — handy for React strict-mode double-invocation when that's
// re-enabled.
export function useTriangulateAttempts(): { ready: boolean } {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const manifest = await loadManifestAttempts();
        const user = loadUserAttempts();
        const attempts = [...manifest, ...user];
        if (cancelled) return;
        const initialId = pickInitialAttemptId(attempts);
        const initialEntry = attempts.find((a) => a.id === initialId);
        const store = useTriangulateStore.getState();
        store.setAttempts(attempts);
        if (initialEntry) {
          store.setCurrentAttempt(initialEntry.id, initialEntry.source);
        }
        const data = await fetchAttemptData(initialEntry);
        if (cancelled) return;
        store.applyAttemptData(data);
        setReady(true);
      } catch (err) {
        console.error("Attempts boot failed:", err);
        setReady(true); // unblock UI even on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ready };
}
