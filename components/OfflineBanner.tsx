"use client";

import { useEffect, useState } from "react";
import { offlineNextMs, offlineStart, offlineStep, offlineText, offlineView } from "@/lib/pwa/offline.mjs";

type State = { online: boolean; sinceMs: number; shown: boolean };
type View = "offline" | "back" | "hidden";
const start = offlineStart as (online: boolean, nowMs: number) => State;
const step = offlineStep as (s: State, online: boolean, nowMs: number) => State;
const viewOf = offlineView as (s: State, nowMs: number) => View;
const nextOf = offlineNextMs as (s: State, nowMs: number) => number | null;

/** Shown while the browser is offline. The service worker (public/sw.js) then
 *  serves the last saved pages and satellites; their element-age tags still
 *  run on the live clock, so the data says how old it is. fromCache: the
 *  page's satellites came from the worker's cache, so say they are saved.
 *  A flapping connection keeps one steady banner (lib/pwa/offline.mjs), and
 *  "Back online." shows briefly once the connection holds. */
export default function OfflineBanner({ fromCache = false }: { fromCache?: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setState(start(navigator.onLine, Date.now()));
    setNowMs(Date.now());
    const onChange = () => {
      const t = Date.now();
      setState((s) => step(s ?? start(!navigator.onLine, t), navigator.onLine, t));
      setNowMs(t);
    };
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    return () => {
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
    };
  }, []);

  // Wake at the next moment the view can change on its own.
  useEffect(() => {
    if (!state) return;
    const next = nextOf(state, nowMs);
    if (next == null) return;
    const id = window.setTimeout(() => setNowMs(Date.now()), Math.max(0, next - Date.now()) + 20);
    return () => window.clearTimeout(id);
  }, [state, nowMs]);

  const view = state ? viewOf(state, nowMs) : "hidden";
  if (view === "hidden") return null;
  return (
    <p className={view === "back" ? "offline-banner offline-banner--back" : "offline-banner"} role="status">
      {view === "back" ? "Back online." : (offlineText as (saved: boolean) => string)(fromCache)}
    </p>
  );
}
