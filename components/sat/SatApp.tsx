"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import FlatMap, { type MapSat } from "@/components/home/FlatMap";
import LiveNumbers from "./LiveNumbers";
import OrbitDiagram from "./OrbitDiagram";
import Downlinks from "./Downlinks";
import PassSection from "./PassSection";
import RawElements from "./RawElements";
import { useHomeStore, watchVisibility } from "@/lib/home/store";
import { followBlockedMessage } from "@/lib/home/actions.mjs";
import { resolveSatellite } from "@/lib/catalog.mjs";
import { makeTrack } from "@/lib/sat/track.mjs";
import { liveNumbers, orbitElements } from "@/lib/sat/numbers.mjs";
import { footprintFeature, groundTrack, subpoint } from "@/lib/map/geometry.mjs";
import { SAT_PALETTE } from "@/lib/map/draw.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import type { satPageData } from "@/lib/sat/page-data.mjs";
import "@/app/home.css";
import "@/app/sat.css";

export type SatPageData = ReturnType<typeof satPageData>;

type Shape = MapSat["track"];
type Sub = { latDeg: number; lonDeg: number; altKm: number };
const subOf = subpoint as (ecef: number[]) => Sub;
const footprintOf = footprintFeature as (sub: Sub, altKm: number, minElevDeg: number) => Shape;
const trackOf = groundTrack as (track: unknown, nowMs: number) => Shape;

const TRACK_REFRESH_MS = 60_000;

function relativeTime(thenMs: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - thenMs) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export default function SatApp({ data }: { data: SatPageData }) {
  const prefs = useHomeStore((s) => s.prefs);
  const hydrate = useHomeStore((s) => s.hydrate);
  const follow = useHomeStore((s) => s.follow);
  const unfollow = useHomeStore((s) => s.unfollow);
  const setPrefs = useHomeStore((s) => s.setPrefs);

  // First render matches the server HTML; the clock starts after mount.
  const [nowMs, setNowMs] = useState(data.renderedAtMs);

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => watchVisibility(), []);
  useEffect(() => {
    let id: number | undefined;
    const stop = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
    };
    const start = () => {
      stop();
      setNowMs(trueNow());
      id = window.setInterval(() => setNowMs(trueNow()), 1000);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (document.hidden) setNowMs(trueNow());
    else start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const track = useMemo(() => {
    try {
      return (makeTrack as (r: unknown, e: unknown) => unknown)(data.record, resolveSatellite(data.noradId));
    } catch {
      return null;
    }
  }, [data.record, data.noradId]);

  const liveNow = useMemo(() => {
    if (!track) return null;
    try { return liveNumbers(track, new Date(nowMs)); } catch { return null; }
  }, [track, nowMs]);
  const elementsNow = useMemo(() => {
    if (!track) return null;
    try { return orbitElements(track); } catch { return null; }
  }, [track]);
  const usable = Boolean(track && liveNow && elementsNow && data.live);

  const trackMinute = Math.floor(nowMs / TRACK_REFRESH_MS);
  const ground = useMemo(() => {
    if (!track || !usable) return null;
    try { return trackOf(track, trackMinute * TRACK_REFRESH_MS); } catch { return null; }
  }, [track, usable, trackMinute]);

  const { sats, selectedSub } = useMemo(() => {
    if (!track || !ground) return { sats: [] as MapSat[], selectedSub: null };
    const ecef = (track as { ecefAt: (d: Date) => number[] | null }).ecefAt(new Date(nowMs));
    if (!ecef) return { sats: [] as MapSat[], selectedSub: null };
    const sub = subOf(ecef);
    const sat: MapSat = {
      noradId: data.noradId,
      name: data.shortName,
      color: SAT_PALETTE[0],
      track: ground,
      position: { lonDeg: sub.lonDeg, latDeg: sub.latDeg },
      footprint: footprintOf(sub, sub.altKm, prefs.minElevDeg),
      selected: true,
    };
    return { sats: [sat], selectedSub: sub };
  }, [track, ground, nowMs, data.noradId, data.shortName, prefs.minElevDeg]);

  const following = prefs.following.includes(data.noradId);
  const blocked = followBlockedMessage(prefs.following, data.noradId) as string | null;

  return (
    <main className="home sat">
      <Link className="home-wordmark" href="/">SeekSat</Link>
      <header className="sat-header">
        <div>
          <h1 className="sat-title">{data.name}</h1>
          <p className="home-note">
            {`NORAD ${data.noradId}`}
            {data.intlDesignator ? ` · ${data.intlDesignator}` : ""}
          </p>
          {data.note ? <p className="home-note">{data.note}</p> : null}
        </div>
        <div className="sat-follow">
          <button
            type="button"
            className="home-button home-button--primary"
            aria-pressed={following}
            disabled={!following && Boolean(blocked)}
            onClick={() => (following ? unfollow(data.noradId) : follow(data.noradId))}
          >
            {following ? "Following" : "Follow"}
          </button>
          {!following && blocked ? <p className="home-note">{blocked}</p> : null}
        </div>
      </header>

      <p className="home-note sat-age">
        {`${data.age.text}, from ${data.source}`}
        {data.fetchedAtMs != null ? `, fetched ${relativeTime(data.fetchedAtMs, nowMs)}.` : "."}
        {data.age.level === "old" ? <span className="sat-badge sat-badge--old">old elements</span> : null}
        {data.age.level === "stale" ? (
          <span className="sat-badge sat-badge--stale">stale elements: positions may be far off</span>
        ) : null}
      </p>

      {usable && liveNow && elementsNow ? (
        <>
          <LiveNumbers live={liveNow} elements={elementsNow} epochMs={data.epochMs} />
          <FlatMap
            sats={sats}
            observer={prefs.location}
            selectedSub={selectedSub}
            projectionId={prefs.projection}
            onProjectionChange={(id) => setPrefs({ projection: id })}
            selectedId={data.noradId}
            onSelect={() => {}}
          />
          <OrbitDiagram track={track} nowMs={nowMs} />
        </>
      ) : (
        <p className="home-note">These elements can&apos;t be used to compute a position.</p>
      )}

      <PassSection track={usable ? track : null} record={data.record} epochMs={data.epochMs} nowMs={nowMs} />

      <Downlinks downlinks={data.downlinks} />
      <RawElements raw={data.raw} />

      <footer className="home-footer">
        <span>
          built by{" "}
          <a href="https://aaronhanson.dev" target="_blank" rel="noopener">Aaron Hanson</a>
        </span>
        <Link href="/classic">3D view</Link>
      </footer>
    </main>
  );
}
