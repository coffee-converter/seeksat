"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import FlatMap, { type MapSat } from "./FlatMap";
import { SearchBar } from "./SearchBar";
import HomeControls from "./HomeControls";
import LocationPrompt, { PopularList } from "./LocationPrompt";
import NextUpList, { type Card, type HomeObserver, type Track } from "./NextUpList";
import { useHomeStore, watchVisibility, type SatApiRecord } from "@/lib/home/store";
import { tracksFor } from "@/lib/home/records.mjs";
import { getPassRunner } from "@/lib/passes/pass-client.mjs";
import { cardJobKey } from "@/lib/passes/job-key.mjs";
import { POPULAR_IDS } from "@/lib/home/prefs.mjs";
import { followedTracks, shouldRefreshCards } from "@/lib/home/view.mjs";
import { footprintFeature, groundTrack, subpoint } from "@/lib/map/geometry.mjs";
import { SAT_PALETTE } from "@/lib/map/draw.mjs";
import { CATALOG } from "@/lib/catalog.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import AboutSection from "./AboutSection";
import ClockSkewBanner from "@/components/passes/ClockSkewBanner";
import "@/app/home.css";

const TRACK_REFRESH_MS = 60_000;
const CARD_REFRESH_MS = 10 * 60_000;

type Shape = MapSat["track"];
type Sub = { latDeg: number; lonDeg: number; altKm: number };
const buildTracks = tracksFor as (records: Map<number, SatApiRecord>, custom: unknown[]) => Map<number, Track>;
const subOf = subpoint as (ecef: number[]) => Sub;
const footprintOf = footprintFeature as (sub: Sub, altKm: number, minElevDeg: number) => Shape;
const trackOf = groundTrack as (track: Track, nowMs: number) => Shape;

interface Props {
  /** Snapshot records for the popular set, shown until the first load lands. */
  initialRecords?: ReadonlyArray<SatApiRecord>;
}

export default function HomeApp({ initialRecords = [] }: Props) {
  const prefs = useHomeStore((s) => s.prefs);
  const hydrated = useHomeStore((s) => s.hydrated);
  const records = useHomeStore((s) => s.records);
  const missing = useHomeStore((s) => s.missing);
  const status = useHomeStore((s) => s.status);
  const error = useHomeStore((s) => s.error);
  const selectedId = useHomeStore((s) => s.selectedId);
  const hydrate = useHomeStore((s) => s.hydrate);
  const loadRecords = useHomeStore((s) => s.loadRecords);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const unfollow = useHomeStore((s) => s.unfollow);
  const setSelectedId = useHomeStore((s) => s.setSelectedId);

  const [nowMs, setNowMs] = useState<number | null>(null);
  const [changingLocation, setChangingLocation] = useState(false);

  useEffect(() => {
    hydrate();
    void loadRecords();
  }, [hydrate, loadRecords]);
  useEffect(() => watchVisibility(), []);
  // The one-second clock that drives the map and cards, on server time once a
  // response has measured the skew (as the banner promises). Starts after mount so
  // the server render and hydration agree, and stops while the tab is hidden.
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

  // The server's snapshot records stand in until the first load lands.
  const seed = useMemo(
    () => new Map(initialRecords.map((r) => [r.noradId as number, r])),
    [initialRecords],
  );
  const shownRecords = records.size > 0 || status === "ready" ? records : seed;
  const tracks = useMemo(
    () => followedTracks(buildTracks(shownRecords, prefs.custom), prefs.following) as Map<number, Track>,
    [shownRecords, prefs.custom, prefs.following],
  );
  const shownMissing = useMemo(
    () => missing.filter((id) => prefs.following.includes(id)),
    [missing, prefs.following],
  );
  const colors = useMemo(
    () => new Map(prefs.following.map((id, i) => [id, SAT_PALETTE[i % SAT_PALETTE.length]])),
    [prefs.following],
  );

  const location = prefs.location;
  const observer = useMemo<HomeObserver | null>(
    () => location && {
      id: "home",
      name: location.name || "Your location",
      latDeg: location.latDeg,
      lonDeg: location.lonDeg,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      elevM: 0,
      elevSource: "default",
    },
    [location],
  );

  // Ground tracks are the costly part of the map: once a minute.
  const trackMinute = nowMs == null ? null : Math.floor(nowMs / TRACK_REFRESH_MS);
  const groundTracks = useMemo(() => {
    const out = new Map<number, Shape>();
    if (trackMinute == null) return out;
    for (const [id, t] of tracks) out.set(id, trackOf(t, trackMinute * TRACK_REFRESH_MS));
    return out;
  }, [tracks, trackMinute]);

  // Positions every second.
  const { sats, selectedSub } = useMemo(() => {
    const list: MapSat[] = [];
    let sel: Sub | null = null;
    if (nowMs == null) return { sats: list, selectedSub: sel };
    const at = new Date(nowMs);
    for (const [id, t] of tracks) {
      const ecef = t.ecefAt(at);
      const track = groundTracks.get(id);
      if (!ecef || !track) continue;
      const sub = subOf(ecef);
      const selected = id === selectedId;
      if (selected) sel = sub;
      list.push({
        noradId: id,
        name: t.shortName,
        color: colors.get(id) ?? SAT_PALETTE[0],
        track,
        position: { lonDeg: sub.lonDeg, latDeg: sub.latDeg },
        footprint: selected ? footprintOf(sub, sub.altKm, prefs.minElevDeg) : null,
        selected,
        orbitClass: t.orbitClass,
      });
    }
    return { sats: list, selectedSub: sel };
  }, [nowMs, tracks, groundTracks, colors, selectedId, prefs.minElevDeg]);

  // Cards: on any input change, every 10 min, and when a pass starts or ends.
  // Cards are kept with the inputs they were computed for and shown only
  // while those still match; a refresh tick keeps the old cards up.
  const cardKey = useMemo(
    () => cardJobKey({
      following: prefs.following, custom: prefs.custom, observer, mode: prefs.mode, minElevDeg: prefs.minElevDeg,
    }),
    [prefs.following, prefs.custom, observer, prefs.mode, prefs.minElevDeg],
  );
  const [cardState, setCardState] = useState<{ cards: Card[]; at: number; key: string } | null>(null);
  const [cardTick, setCardTick] = useState(0);
  const cardRequest = useRef(0);
  const warned = useRef(false);
  const inFlight = useRef(false);
  const retryAt = useRef<number | null>(null);
  useEffect(() => {
    const request = ++cardRequest.current;
    retryAt.current = null;
    if (!observer) {
      inFlight.current = false;
      setCardState(null);
      return;
    }
    inFlight.current = true;
    const at = trueNow();
    // Only the followed records cross to the worker; custom elements ride along.
    const followed = prefs.following;
    getPassRunner()
      .run({
        kind: "next-up",
        records: [...shownRecords.values()].filter((r) => followed.includes(r.noradId as number)),
        custom: prefs.custom,
        following: followed,
        missing: shownMissing,
        observer,
        mode: prefs.mode,
        minElevDeg: prefs.minElevDeg,
        nowMs: at,
      })
      .then((cards: unknown) => {
        if (request !== cardRequest.current) return;
        inFlight.current = false;
        setCardState({ cards: cards as unknown as Card[], at, key: cardKey });
      })
      .catch((e: unknown) => {
        if (request === cardRequest.current) {
          inFlight.current = false;
          retryAt.current = trueNow() + CARD_REFRESH_MS;
        }
        if (warned.current) return;
        warned.current = true;
        console.warn("Pass search failed; keeping the previous cards.", e);
      });
  }, [shownRecords, prefs.custom, prefs.following, shownMissing, observer, prefs.mode, prefs.minElevDeg, cardKey, cardTick]);
  useEffect(() => {
    if (!observer) return;
    if (shouldRefreshCards({
      cardState, nowMs, inFlight: inFlight.current, retryAtMs: retryAt.current, refreshMs: CARD_REFRESH_MS,
    })) {
      setCardTick((t) => t + 1);
    }
  }, [nowMs, cardState, observer]);

  const popularNames = useMemo(() => {
    const names = new Map<number, string>();
    for (const id of POPULAR_IDS) {
      const name = CATALOG.find((s) => s.noradId === id)?.shortName
        ?? records.get(id)?.name ?? seed.get(id)?.name;
      if (name) names.set(id, String(name));
    }
    return names;
  }, [records, seed]);

  const showPrompt = hydrated && (!location || changingLocation);

  return (
    <main className="home">
      <h1 className="home-wordmark">SeekSat</h1>
      <ClockSkewBanner />
      <SearchBar />
      <FlatMap
        sats={sats}
        observer={location}
        selectedSub={selectedSub}
        projectionId={prefs.projection}
        onProjectionChange={(id) => setPrefs({ projection: id })}
        selectedId={selectedId}
        minElevDeg={prefs.minElevDeg}
        onSelect={setSelectedId}
      />
      <HomeControls
        ready={hydrated}
        mode={prefs.mode}
        minElevDeg={prefs.minElevDeg}
        locationName={location && !changingLocation ? location.name : null}
        onModeChange={(mode) => setPrefs({ mode })}
        onMinElevChange={(minElevDeg) => setPrefs({ minElevDeg })}
        onChangeLocation={() => setChangingLocation(true)}
      />

      {status === "error" && (
        <div className="home-banner" role="alert">
          <span>{error ?? "Something went wrong loading satellites."}</span>
          <button type="button" className="home-button" onClick={() => void loadRecords()}>
            Try again
          </button>
        </div>
      )}

      {!hydrated ? null : showPrompt ? (
        <>
          <LocationPrompt
            onDone={() => setChangingLocation(false)}
            onCancel={location ? () => setChangingLocation(false) : undefined}
          />
          {!location && <PopularList names={popularNames} />}
        </>
      ) : observer && (
        <>
          {prefs.following.length === 0 ? (
            <>
              <p className="home-note">You aren&apos;t following any satellites. Search above to add one.</p>
              <PopularList names={popularNames} />
            </>
          ) : !cardState || (cardState.cards.length === 0 && status === "loading") ? (
            <p className="home-note">Loading satellites...</p>
          ) : cardState.key !== cardKey ? (
            <p className="home-note" role="status">Finding passes...</p>
          ) : (
            nowMs != null && (
              <NextUpList
                cards={cardState.cards}
                tracks={tracks}
                colors={colors}
                observer={observer}
                mode={prefs.mode}
                minElevDeg={prefs.minElevDeg}
                nowMs={nowMs}
                onUnfollow={unfollow}
              />
            )
          )}
        </>
      )}

      <AboutSection />

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
