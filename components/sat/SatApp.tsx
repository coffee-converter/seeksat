"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FlatMap from "@/components/home/FlatMap";
import FocusBar from "@/components/home/FocusBar";
import { SearchBar } from "@/components/home/SearchBar";
import MapShell from "@/components/MapShell";
import { useMapSats, type Layer, type MapTrack } from "@/components/home/useMapSats";
import DashboardTiles, { type NextPassTile } from "./LiveNumbers";
import ElementsTable, { AgeLine } from "./ElementsTable";
import HowWeCompute from "./HowWeCompute";
import LiveClock from "@/components/LiveClock";
import OrbitDiagram from "./OrbitDiagram";
import Downlinks from "./Downlinks";
import ShareButton from "./ShareButton";
import { shareUrl } from "@/lib/share/share-link.mjs";
import PassSection, { type NextPassReport, type PassSettings } from "./PassSection";
import RawElements from "./RawElements";
import { useHomeStore, type SatApiRecord } from "@/lib/home/store";
import { satPageLayers, showAllCount } from "@/lib/home/focus.mjs";
import { tracksFor } from "@/lib/home/records.mjs";
import { followedTracks } from "@/lib/home/view.mjs";
import { followBlockedMessage } from "@/lib/home/actions.mjs";
import { resolveSatellite } from "@/lib/catalog.mjs";
import { makeTrack } from "@/lib/sat/track.mjs";
import { elementAge, liveNumbers, orbitElements, relativeTime } from "@/lib/sat/numbers.mjs";
import { SAT_PALETTE } from "@/lib/map/draw.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { nextPassTile } from "@/lib/sat/next-pass-tile.mjs";
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

const pageLayersOf = satPageLayers as (o: {
  followed: number[]; hidden: number[]; focusId: number | null; pageId: number;
}) => Layer[];
const countOf = showAllCount as (layers: Layer[]) => number;
type HomeTrack = MapTrack & { record?: { source?: string } };
const buildTracks = tracksFor as (records: Map<number, SatApiRecord>, custom: unknown[]) => Map<number, HomeTrack>;
const tileOf = nextPassTile as (next: NextPassReport, o: {
  nowMs: number; located: boolean; hydrated: boolean; mode: string; minElevDeg: number;
}) => NextPassTile;

export default function SatApp({ data, shared: sharedIn = null }: { data: SatPageData; shared?: SharedBlob | null }) {
  const router = useRouter();
  const prefs = useHomeStore((s) => s.prefs);
  const hydrate = useHomeStore((s) => s.hydrate);
  const hydrated = useHomeStore((s) => s.hydrated);
  const follow = useHomeStore((s) => s.follow);
  const unfollow = useHomeStore((s) => s.unfollow);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const records = useHomeStore((s) => s.records);
  const loadRecords = useHomeStore((s) => s.loadRecords);

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
    // Ticks land on whole seconds of the displayed (skew-corrected) clock:
    // one timeout to the next boundary, then a 1 s interval.
    let first: number | undefined;
    let id: number | undefined;
    const stop = () => {
      if (first !== undefined) window.clearTimeout(first);
      if (id !== undefined) window.clearInterval(id);
      first = undefined;
      id = undefined;
    };
    const start = () => {
      stop();
      setNowMs(trueNow());
      first = window.setTimeout(() => {
        first = undefined;
        setNowMs(trueNow());
        id = window.setInterval(() => setNowMs(trueNow()), 1000);
      }, 1000 - (trueNow() % 1000));
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

  // The map starts focused on this satellite. Show all draws the followed
  // ones too, without navigating; their records load on the first Show all.
  const [focusId, setFocusId] = useState<number | null>(data.noradId);
  const loadedOthers = useRef(false);
  const showAll = useCallback(() => {
    setFocusId(null);
    if (!loadedOthers.current) {
      loadedOthers.current = true;
      void loadRecords();
    }
  }, [loadRecords]);
  useEffect(() => {
    if (focusId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      showAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId, showAll]);

  const mapTracks = useMemo(() => {
    const out = new Map<number, HomeTrack>(
      followedTracks(buildTracks(records, prefs.custom), prefs.following) as Map<number, HomeTrack>,
    );
    if (track && usable) out.set(data.noradId, track as HomeTrack);
    return out;
  }, [records, prefs.custom, prefs.following, track, usable, data.noradId]);
  const colors = useMemo(() => {
    const out = new Map(prefs.following.map((id, i) => [id, SAT_PALETTE[i % SAT_PALETTE.length]]));
    // Not followed: the next colour, as a viewing satellite gets on the home page.
    if (!out.has(data.noradId)) out.set(data.noradId, SAT_PALETTE[out.size % SAT_PALETTE.length]);
    return out;
  }, [prefs.following, data.noradId]);
  const layers = useMemo(() => pageLayersOf({
    followed: prefs.following, hidden: prefs.hidden, focusId, pageId: data.noradId,
  }), [prefs.following, prefs.hidden, focusId, data.noradId]);
  const showAllTotal = countOf(pageLayersOf({
    followed: prefs.following, hidden: prefs.hidden, focusId: null, pageId: data.noradId,
  }));
  const { sats, focusSub } = useMapSats({
    layers, tracks: mapTracks, colors, nowMs, minElevDeg: settings.minElevDeg,
  });
  const focusName = focusId === data.noradId ? data.shortName : focusId != null ? mapTracks.get(focusId)?.shortName ?? `NORAD ${focusId}` : "";
  const focusFollowed = focusId != null && prefs.following.includes(focusId);

  const [nextPass, setNextPass] = useState<NextPassReport>(undefined);
  const nextTile = tileOf(nextPass, {
    nowMs,
    located: Boolean(settings.observer),
    hydrated: hydrated || Boolean(shared),
    mode: settings.mode,
    minElevDeg: settings.minElevDeg,
  });
  const fetchedText = data.fetchedAtMs != null ? `fetched ${relativeTime(data.fetchedAtMs, nowMs)}` : null;

  const following = prefs.following.includes(data.noradId);
  const blocked = followBlockedMessage(prefs.following, data.noradId) as string | null;

  const map = (
    <FlatMap
      fill
      sats={sats}
      observer={settings.observer}
      selectedSub={focusSub}
      projectionId={prefs.projection}
      onProjectionChange={(id) => setPrefs({ projection: id })}
      selectedId={focusId}
      minElevDeg={settings.minElevDeg}
      onSelect={setFocusId}
      top={usable && focusId != null && (
        <FocusBar
          name={focusName}
          followed={focusFollowed}
          blocked={followBlockedMessage(prefs.following, focusId) as string | null}
          total={showAllTotal}
          pageHref={focusId === data.noradId || mapTracks.get(focusId)?.record?.source === "pasted"
            ? null
            : `/sat/${focusId}`}
          onToggleFollow={() => (focusFollowed ? unfollow(focusId) : follow(focusId))}
          onShowAll={showAll}
        />
      )}
    />
  );

  return (
    <MapShell
      className="sat"
      top={(
        <>
          <Link className="home-wordmark" href="/">SeekSat</Link>
          <div className="map-shell__search">
            {/* A search result opens that satellite's page; Esc in an empty search shows all. */}
            <SearchBar onView={(id) => router.push(satPath(id))} onClearFocus={showAll} />
          </div>
          <LiveClock nowMs={nowMs} compact />
        </>
      )}
      map={map}
      panel={(
        <>
          <header className="sat-top">
            <h1 className="sat-title">{data.name}</h1>
            <p className="home-note">
              {`NORAD ${data.noradId}`}
              {data.intlDesignator ? ` · ${data.intlDesignator}` : ""}
            </p>
            {data.note ? <p className="home-note">{data.note}</p> : null}
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
            </div>
            {!following && blocked ? <p className="home-note">{blocked}</p> : null}
          </header>

          {shared ? (
            <div className="sat-shared" role="status">
              <p className="sat-shared__text">{bannerOf(shared)}</p>
              <button type="button" className="home-button" onClick={leaveShared}>
                Use my location and settings
              </button>
            </div>
          ) : null}

          {usable && liveNow && elementsNow ? (
            <>
              <DashboardTiles live={liveNow} elements={elementsNow} nextPass={nextTile} />
              <ElementsTable
                elements={elementsNow}
                age={age}
                source={data.source}
                fetchedText={fetchedText}
                epochMs={epochMs}
              />
              <OrbitDiagram track={track} nowMs={nowMs} />
            </>
          ) : (
            <>
              <AgeLine age={age} source={data.source} fetchedText={fetchedText} />
              <p className="home-note">These elements can&apos;t be used to compute a position.</p>
            </>
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
            onNextPass={setNextPass}
          />

          <Downlinks downlinks={data.downlinks} />
          <RawElements raw={data.raw} />
          {usable ? <HowWeCompute /> : null}

          <footer className="home-footer">
            <span>
              built by{" "}
              <a href="https://aaronhanson.dev" target="_blank" rel="noopener">Aaron Hanson</a>
            </span>
          </footer>
        </>
      )}
    />
  );
}
