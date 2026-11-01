"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FlatMap, { type MapSat } from "@/components/home/FlatMap";
import LiveNumbers from "./LiveNumbers";
import OrbitDiagram from "./OrbitDiagram";
import Downlinks from "./Downlinks";
import ShareButton from "./ShareButton";
import { shareUrl } from "@/lib/share/share-link.mjs";
import PassSection, { type PassSettings } from "./PassSection";
import RawElements from "./RawElements";
import { useHomeStore } from "@/lib/home/store";
import { followBlockedMessage } from "@/lib/home/actions.mjs";
import { resolveSatellite } from "@/lib/catalog.mjs";
import { makeTrack } from "@/lib/sat/track.mjs";
import { elementAge, liveNumbers, orbitElements, relativeTime } from "@/lib/sat/numbers.mjs";
import { footprintFeature, groundTrack, subpoint } from "@/lib/map/geometry.mjs";
import { SAT_PALETTE } from "@/lib/map/draw.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { satPath, type satPageData } from "@/lib/sat/page-data.mjs";
import { effectiveSettings, sharedBannerText, sharedSettings } from "@/lib/sat/shared-view.mjs";
import type { decodeStateBlob } from "@/lib/pass-finder/state-blob.js";
import "@/app/home.css";
import "@/app/sat.css";

export type SatPageData = ReturnType<typeof satPageData>;
export type SharedBlob = NonNullable<ReturnType<typeof decodeStateBlob>>;
type Shared = {
  observer: NonNullable<PassSettings["observer"]>;
  observers: PassSettings["observers"];
  mode: PassSettings["mode"];
  minElevDeg: number;
  passTimeMs: number | null;
  freqHz: number | null;
};
const sharedOf = sharedSettings as (d: SharedBlob | null | undefined) => Shared | null;
const effectiveOf = effectiveSettings as (prefs: unknown, shared: Shared | null) => PassSettings;
const bannerOf = sharedBannerText as (s: Shared) => string;

type Shape = MapSat["track"];
type Sub = { latDeg: number; lonDeg: number; altKm: number };
const subOf = subpoint as (ecef: number[]) => Sub;
const footprintOf = footprintFeature as (sub: Sub, altKm: number, minElevDeg: number) => Shape;
const trackOf = groundTrack as (track: unknown, nowMs: number) => Shape;

const TRACK_REFRESH_MS = 60_000;

export default function SatApp({ data, shared: sharedIn = null }: { data: SatPageData; shared?: SharedBlob | null }) {
  const router = useRouter();
  const prefs = useHomeStore((s) => s.prefs);
  const hydrate = useHomeStore((s) => s.hydrate);
  const follow = useHomeStore((s) => s.follow);
  const unfollow = useHomeStore((s) => s.unfollow);
  const setPrefs = useHomeStore((s) => s.setPrefs);

  // A shared view lives here only, laid over the prefs and never saved.
  // It comes from the server-decoded prop, so the first render matches.
  const [shared, setShared] = useState<Shared | null>(() => sharedOf(sharedIn));
  const settings = useMemo(() => effectiveOf(prefs, shared), [prefs, shared]);
  // The radio chart's picked frequency (a shared view's, until one is picked).
  const pickedFreq = useRef<number | null>(sharedIn ? shared?.freqHz ?? null : null);
  const headerLink = () => shareUrl(window.location.origin, {
    noradId: data.noradId,
    observers: [settings.observer, ...settings.observers].map((o) => ({ name: o!.name, latDeg: o!.latDeg, lonDeg: o!.lonDeg })),
    passMs: null,
    mode: settings.mode,
    freqHz: pickedFreq.current,
    minElevDeg: settings.minElevDeg,
  }) as string;
  const onModeChange = useCallback((mode: PassSettings["mode"]) => {
    if (shared) setShared((s) => (s ? { ...s, mode } : s));
    else setPrefs({ mode });
  }, [shared, setPrefs]);
  const onMinElevChange = useCallback((minElevDeg: number) => {
    if (shared) setShared((s) => (s ? { ...s, minElevDeg } : s));
    else setPrefs({ minElevDeg });
  }, [shared, setPrefs]);
  const leaveShared = () => {
    setShared(null);
    router.replace(satPath(data.noradId));
  };

  // First render matches the server HTML; the clock starts after mount.
  const [nowMs, setNowMs] = useState(data.renderedAtMs);

  useEffect(() => { hydrate(); }, [hydrate]);
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

  // Age from the live clock, so it never contradicts "fetched X ago". The
  // first nowMs is renderedAtMs, so the first render matches the server's.
  // data.elementEpochMs is data.epochMs, falling back to the track's epoch.
  const epochMs = data.elementEpochMs;
  const age = useMemo(() => elementAge(epochMs, nowMs), [epochMs, nowMs]);

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
      footprint: footprintOf(sub, sub.altKm, settings.minElevDeg),
      selected: true,
      orbitClass: (track as { orbitClass: string }).orbitClass,
    };
    return { sats: [sat], selectedSub: sub };
  }, [track, ground, nowMs, data.noradId, data.shortName, settings.minElevDeg]);

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
          {settings.observer && (
            <ShareButton url={headerLink} title={data.name} size="button" />
          )}
          {!following && blocked ? <p className="home-note">{blocked}</p> : null}
        </div>
      </header>

      {shared ? (
        <div className="sat-shared" role="status">
          <p className="sat-shared__text">{bannerOf(shared)}</p>
          <button type="button" className="home-button" onClick={leaveShared}>
            Use my location and settings
          </button>
        </div>
      ) : null}

      <p className="home-note sat-age">
        {`${age.text}, from ${data.source}`}
        {data.fetchedAtMs != null ? `, fetched ${relativeTime(data.fetchedAtMs, nowMs)}.` : "."}
        {age.level === "old" ? <span className="sat-badge sat-badge--old">old elements</span> : null}
        {age.level === "stale" ? (
          <span className="sat-badge sat-badge--stale">stale elements: positions may be far off</span>
        ) : null}
      </p>

      {usable && liveNow && elementsNow ? (
        <>
          <LiveNumbers live={liveNow} elements={elementsNow} epochMs={epochMs} />
          <FlatMap
            sats={sats}
            observer={settings.observer}
            selectedSub={selectedSub}
            projectionId={prefs.projection}
            onProjectionChange={(id) => setPrefs({ projection: id })}
            selectedId={data.noradId}
            minElevDeg={settings.minElevDeg}
            onSelect={() => {}}
          />
          <OrbitDiagram track={track} nowMs={nowMs} />
        </>
      ) : (
        <p className="home-note">These elements can&apos;t be used to compute a position.</p>
      )}

      <PassSection
        track={usable ? track : null}
        record={data.record}
        epochMs={epochMs}
        nowMs={nowMs}
        settings={settings}
        onModeChange={onModeChange}
        onMinElevChange={onMinElevChange}
        sharedPassMs={shared?.passTimeMs ?? null}
        preferredFreqHz={shared?.freqHz ?? null}
        onFreqPicked={(hz) => { pickedFreq.current = hz; }}
      />

      <Downlinks downlinks={data.downlinks} />
      <RawElements raw={data.raw} />

      <footer className="home-footer">
        <span>
          built by{" "}
          <a href="https://aaronhanson.dev" target="_blank" rel="noopener">Aaron Hanson</a>
        </span>
      </footer>
    </main>
  );
}
