"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import HomeControls from "@/components/home/HomeControls";
import ExtraObservers from "@/components/sat/ExtraObservers";
import LocationPrompt from "@/components/home/LocationPrompt";
import { passRating, type HomeObserver, type Pass as HomePass, type Track as HomeTrack } from "@/components/home/NextUpList";
import PassRow, { passRowsClass } from "@/components/home/PassRow";
import PassRowOpen from "@/components/home/PassRowOpen";
import { useKeepRowInPlace } from "@/components/home/useKeepRowInPlace";
import { toggleOpen } from "@/lib/ui/open-row.mjs";
import type { ChartSubject } from "@/components/passes/PassChartModals";
import { useHomeStore, type ExtraObserver } from "@/lib/home/store";
import { getPassRunner } from "@/lib/passes/pass-client.mjs";
import { DEFAULT_SEARCH_DAYS } from "@/lib/passes/engine.mjs";
import { passToIcs, icsFileName } from "@/lib/passes/ics.mjs";
import { downloadText } from "@/lib/passes/download.js";
import { passRows, printAccuracyNote, rowAccuracyNote, zoneLabel, initialRowCount, groupRowsByDay, directionText } from "@/lib/sat/pass-rows.mjs";
import QualityBadge from "@/components/passes/QualityBadge";
import type { Forecast } from "@/lib/sky/use-clouds";
import { passJobKey } from "@/lib/passes/job-key.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { defaultDownlink } from "@/lib/catalog.mjs";
import { uplinkText } from "@/lib/radio/uplink.mjs";
import { placesLine } from "@/lib/sat/places-line.mjs";
import { shareUrl } from "@/lib/share/share-link.mjs";
import { findSharedRow } from "@/lib/sat/shared-view.mjs";
import Button from "@/components/ui/Button";
import { usePlaceZone } from "@/components/usePlaceZone";
import { rowDetail, rowWhen } from "@/lib/home/pass-list.mjs";
import { startIsRise, underWay as underWayAt } from "@/lib/passes/under-way.mjs";

// The chart painters load on the first chart open, not with the page.
const DAY_MS = 86_400_000;
const PassChartModals = dynamic(() => import("@/components/passes/PassChartModals"), { ssr: false });

type Pass = { startMs: number; endMs: number; [k: string]: unknown };
/** The first listed pass, as the page's next pass line reads it. */
export type NextPass = Pass & { peakMs?: number; maxElevDeg?: number };
/** What the search found, for the next pass line. undefined while searching. */
export type NextPassReport =
  | undefined
  | { kind: "pass"; pass: NextPass; timeZone?: string }
  | { kind: "none" }
  | { kind: "stationary"; visible: boolean }
  | { kind: "failed" }
  | { kind: "unavailable" };
type Row = {
  key: string; dayLabel: string; startLabel: string; peakLabel: string; endLabel: string; timesLabel: string;
  durationLabel: string; maxElevLabel: string; azLabel: string; fromLabel: string; toLabel: string;
  visible: boolean; inProgress: boolean; runsPastEnd: boolean; accuracy: string | null; pass: Pass;
};
type View =
  | { kind: "rows"; rows: Row[] }
  | { kind: "message" | "stationary"; text: string };
type Track = { name: string; shortName: string; noradId: number };

const rowsOf = passRows as unknown as (r: unknown, o: Record<string, unknown>) => View;
const bearings = directionText as (pass: { startAzDeg: number; endAzDeg: number }) => string;
const whenOf = rowWhen as (pass: HomePass, nowMs: number, timeZone?: string) => { time: string; sub: string };
const detailOf = rowDetail as (pass: HomePass) => string;
const underWay = underWayAt as (pass: HomePass, nowMs: number) => boolean;
const groupRows = (rows: Row[], nowMs: number, timeZone?: string) =>
  (groupRowsByDay as (r: Row[], n: number, tz?: string, l?: string) => Array<{ heading: string; rows: Row[] }>)(rows, nowMs, timeZone);
const toIcs = passToIcs as unknown as (o: Record<string, unknown>) => string;
const icsName = icsFileName as (sat: string, place: string, startMs: number) => string;
type SharedHit = { kind: "row"; key: string } | { kind: "past"; text: string } | null;
const sharedRowOf = findSharedRow as (
  rows: Row[], passTimeMs: number | null, nowMs: number, o: { timeZone?: string; locale?: string },
) => SharedHit;

type ChartKind = "sky" | "radio" | "live";
/** What the page reaches through PassSection's ref: the rows' chart opener,
 *  so a line above the section opens the same modals. */
export interface PassSectionHandle {
  openChart: (kind: ChartKind, pass: NextPass, e: React.MouseEvent<HTMLButtonElement>) => void;
}

/** effectiveSettings(): the saved prefs, or a shared view laid over them. */
export interface PassSettings {
  observer: { name: string; latDeg: number; lonDeg: number } | null;
  observers: ExtraObserver[];
  mode: "radio" | "visual";
  minElevDeg: number;
  isShared: boolean;
}

/** "1 Nov 2026", the local date in the place's time zone. */
function printDate(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
}

const UNAVAILABLE = "These elements can't be used to compute passes.";
const SEARCH_FAILED = "Pass search failed. Reload the page to try again.";

interface Props {
  track: unknown;
  record: unknown;
  epochMs: number | null;
  nowMs: number;
  settings: PassSettings;
  onModeChange: (mode: "radio" | "visual") => void;
  onMinElevChange: (deg: number) => void;
  /** The sky type for the visual rating (always the user's own pref, even in a shared view). */
  skyType: string;
  onSkyTypeChange: (skyType: string) => void;
  /** A shared view's pass start, highlighted in the list. */
  sharedPassMs?: number | null;
  /** A shared view's radio frequency, used by the radio chart. */
  preferredFreqHz?: number | null;
  /** Reports the radio chart's picked frequency (for the page's Share button). */
  onFreqPicked?: (hz: number | null) => void;
  /**
   * What the search found whenever it changes: the first listed pass, or
   * why there is none. undefined while searching or with no location.
   */
  onNextPass?: (report: NextPassReport) => void;
  /** The cloud forecast for the location (from `useClouds`), badged on visual passes. */
  clouds?: Forecast | null;
  /** The satellite's map colour, for the rows' leading bar. */
  color?: string;
  ref?: React.Ref<PassSectionHandle>;
}

export default function PassSection({
  track: trackIn, record, epochMs, nowMs, settings, onModeChange, onMinElevChange, skyType, onSkyTypeChange,
  sharedPassMs = null, preferredFreqHz = null, onFreqPicked, onNextPass, clouds = null, color = "var(--map-muted)", ref,
}: Props) {
  const track = trackIn as Track | null;
  const hydrated = useHomeStore((s) => s.hydrated);
  const clearObservers = useHomeStore((s) => s.clearObservers);
  const [changingLocation, setChangingLocation] = useState(false);
  const shared = settings.isShared;
  const { mode, minElevDeg } = settings;

  const location = settings.observer;
  // Times read as the clock at the place, not the viewer's.
  const tz = usePlaceZone(location?.latDeg, location?.lonDeg);
  const observer = useMemo<HomeObserver | null>(
    () => location && {
      id: "home",
      name: location.name || "Your location",
      latDeg: location.latDeg,
      lonDeg: location.lonDeg,
      tz,
      elevM: 0,
      elevSource: "default",
    },
    [location, tz],
  );

  const extra = settings.observers;
  const observers = useMemo<HomeObserver[]>(
    () => observer
      ? [observer, ...extra.map((o) => ({ ...o, tz: observer.tz, elevM: 0, elevSource: "default" }))]
      : [],
    [observer, extra],
  );
  const joint = extra.length > 0;
  const placesText = (placesLine as (n: string[]) => string | null)(observers.map((o) => o.name));
  const names = useMemo(
    () => Object.fromEntries(observers.map((o) => [o.id, o.name])) as Record<string, string>,
    [observers],
  );

  // A result is kept with the inputs it was computed for, and shown only
  // while they still match, so a chart or .ics never pairs an old pass with
  // new places or settings. A refresh tick is not part of the key.
  const recordId = (record as { noradId?: number } | null)?.noradId ?? null;
  const jobKey = useMemo(
    () => passJobKey({ observers, mode, minElevDeg, recordId }),
    [observers, mode, minElevDeg, recordId],
  );
  const [stored, setStored] = useState<{ key: string; result: unknown } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const request = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const mine = ++request.current;
    if (!observer || !track) {
      inFlight.current = false;
      setBusy(false);
      setStored(null);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    const startMs = trueNow();
    getPassRunner()
      .run({
        kind: "passes",
        record,
        observers,
        mode,
        minElevDeg,
        startMs,
        endMs: startMs + DEFAULT_SEARCH_DAYS * 86_400_000,
      })
      .then((r: unknown) => {
        if (mine !== request.current) return;
        inFlight.current = false;
        setBusy(false);
        setStored({ key: jobKey, result: r });
      })
      .catch((e: unknown) => {
        if (mine !== request.current) return;
        inFlight.current = false;
        setBusy(false);
        setFailed(true);
        console.warn("Pass search failed.", e);
      });
  }, [track, record, observer, observers, mode, minElevDeg, jobKey, tick]);

  // The clock in 15 s steps, so rows re-derive without a per-second pass.
  const bucketMs = Math.floor(nowMs / 15_000) * 15_000;
  const result = stored && stored.key === jobKey ? stored.result : null;
  const view = useMemo<View | null>(() => {
    if (failed) return { kind: "message", text: SEARCH_FAILED };
    if (!result || !observer) return null;
    return rowsOf(result, {
      epochMs,
      nowMs: bucketMs,
      minElevDeg,
      mode,
      timeZone: observer.tz,
      locale: undefined,
      names,
    });
  }, [result, failed, observer, epochMs, bucketMs, minElevDeg, mode, names]);

  // Report the first row, or why there is none, to the next pass line.
  // Read from the raw result so a stationary or failed search says so.
  const firstPass = view && view.kind === "rows" ? (view.rows[0].pass as NextPass) : null;
  // One "elements are old" note, on the first pass it applies to.
  const oldNote = view && view.kind === "rows" ? (rowAccuracyNote as (rows: Row[]) => { key: string; text: string } | null)(view.rows) : null;
  const nextReport = useMemo<NextPassReport>(() => {
    if (!track) return { kind: "unavailable" };
    if (!observer) return undefined;
    if (failed) return { kind: "failed" };
    if (!result) return undefined;
    const r = result as { kind?: string; visible?: boolean; pointing?: unknown[] };
    if (r.kind === "unavailable") return { kind: "unavailable" };
    if (r.kind === "stationary") return r.pointing?.[0] ? { kind: "stationary", visible: Boolean(r.visible) } : { kind: "unavailable" };
    return firstPass ? { kind: "pass", pass: firstPass, timeZone: observer.tz } : { kind: "none" };
  }, [track, observer, failed, result, firstPass]);
  useEffect(() => { onNextPass?.(nextReport); }, [nextReport, onNextPass]);

  // The shared pass: highlighted in the list, or a note that it is over.
  const sharedHit = useMemo<SharedHit>(() => {
    if (!shared || failed || !view || !observer) return null;
    return sharedRowOf(view.kind === "rows" ? view.rows : [], sharedPassMs, bucketMs, {
      timeZone: observer.tz,
      locale: undefined,
    });
  }, [shared, failed, view, observer, sharedPassMs, bucketMs]);
  const sharedKey = sharedHit?.kind === "row" ? sharedHit.key : null;
  // Ten days of passes is a long page on a phone: show two days, then a button.
  const [showAll, setShowAll] = useState(false);
  // The one open row: the shared row until the viewer taps one (undefined),
  // then the row they opened, or none.
  const [chosenKey, setChosenKey] = useState<string | null | undefined>(undefined);
  const openKey = chosenKey === undefined ? sharedKey : chosenKey;
  const keepInPlace = useKeepRowInPlace();
  const toggleRow = (key: string, button: HTMLElement) => {
    keepInPlace(button);
    setChosenKey(toggleOpen(openKey, key) as string | null);
  };
  const rowCount = view?.kind === "rows"
    ? (showAll ? view.rows.length : (initialRowCount as (r: Row[], n: number, o: { sharedKey: string | null }) => number)(view.rows, bucketMs, { sharedKey }))
    : 0;
  // Grouping formats each row's date, so it reruns per 15 s bucket, not per
  // 1 s render.
  const groups = useMemo(
    () => (view?.kind === "rows" ? groupRows(view.rows.slice(0, rowCount), bucketMs, observer?.tz) : []),
    [view, rowCount, bucketMs, observer?.tz],
  );
  const zone = observer ? (zoneLabel as (tz: string | undefined, ms: number, locale?: string) => string)(observer.tz, bucketMs) : "UTC";

  // Scroll to the shared pass once, when the first rows arrive.
  const sharedRow = useRef<HTMLLIElement | null>(null);
  const scrolled = useRef(false);
  const hasRows = view?.kind === "rows";
  useEffect(() => {
    if (!shared || scrolled.current || !hasRows) return;
    scrolled.current = true;
    sharedRow.current?.scrollIntoView({ block: "center" });
  }, [shared, hasRows, sharedKey]);

  // Search again once the first pass has ended (never while a job runs, and
  // never after a failure).
  const firstEnd = view && view.kind === "rows" ? view.rows[0].pass.endMs : null;
  useEffect(() => {
    if (firstEnd != null && !failed && !inFlight.current && nowMs >= firstEnd) setTick((t) => t + 1);
  }, [nowMs, firstEnd, failed]);

  // A geosynchronous satellite always above the horizon here: its pointing
  // over the day, for the 24-hour charts.
  const alwaysUp = useMemo(() => {
    const r = result as { kind?: string; visible?: boolean; pointing?: { azDeg: number | null; elMinDeg: number | null; elMaxDeg: number | null }[] } | null;
    const p = r?.kind === "stationary" && r.visible ? r.pointing?.[0] : null;
    return p && p.elMaxDeg != null ? p : null;
  }, [result]);

  // The subject is captured at open, so the clock never repaints an open chart.
  const [subject, setSubject] = useState<ChartSubject | null>(null);
  const [chart, setChart] = useState<ChartKind | null>(null);
  const [chartsLoaded, setChartsLoaded] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  const openChart = (kind: ChartKind, pass: Pass, e: React.MouseEvent<HTMLButtonElement>) => {
    if (!observer) return;
    trigger.current = e.currentTarget;
    setChartsLoaded(true);
    setSubject({ track, obs: observer, pass, minElevDeg, jointWindow: joint ? { startMs: pass.startMs, endMs: pass.endMs } : null } as unknown as ChartSubject);
    setChart(kind);
  };
  useImperativeHandle(ref, () => ({ openChart }));
  /** The 24-hour window from now, shaped as a pass, for a satellite that never sets. */
  const dayPass = (p: { azDeg: number | null; elMaxDeg: number | null }): Pass => {
    const startMs = trueNow();
    return {
      startMs, endMs: startMs + DAY_MS, peakMs: startMs, durationMs: DAY_MS,
      maxElevDeg: p.elMaxDeg ?? 0, startAzDeg: p.azDeg, endAzDeg: null, day: true,
    } as Pass;
  };
  const onClose = useCallback(() => {
    setChart(null);
    trigger.current?.focus();
  }, []);

  const onFreqChange = useCallback((hz: number | null) => {
    onFreqPicked?.(hz);
  }, [onFreqPicked]);

  // Called from event handlers only (reads window.location.origin).
  const linkFor = (passMs: number | null, freqHz: number | null) => shareUrl(window.location.origin, {
    noradId: track?.noradId,
    observers: observers.map((o) => ({ name: o.name, latDeg: o.latDeg, lonDeg: o.lonDeg })),
    passMs,
    mode,
    freqHz,
    minElevDeg,
  }) as string;

  const addToCalendar = (pass: Pass, inProgress: boolean) => {
    if (!observer || !track) return;
    const ics = toIcs({
      satName: track.name,
      noradId: track.noradId,
      observer: { name: observer.name, latDeg: observer.latDeg, lonDeg: observer.lonDeg },
      pass,
      mode,
      nowMs: trueNow(),
      url: linkFor((pass as { peakMs?: number }).peakMs ?? null, null),
      observerCount: observers.length,
      inProgress,
    });
    downloadText(ics, icsName(track.shortName, observer.name, pass.startMs), "text/calendar");
  };

  /** One pass as the home list's compact row, opening to the home list's
   *  open row with this page's links, tags and bearings. */
  const passRow = (row: Row) => {
    const pass = row.pass as unknown as HomePass;
    const isShared = row.key === sharedKey;
    const id = `pass-open-${row.key}`;
    // Up when the search ran: its rise is not known here, so it reads "Now".
    const { time, sub } = whenOf(startIsRise(pass) ? pass : { ...pass, riseUnknown: true }, nowMs, observer?.tz);
    const rating = mode === "visual" ? passRating(pass, { mode, skyType, clouds, nowMs: bucketMs }) : undefined;
    return (
      <PassRow
        key={row.key}
        ref={isShared ? sharedRow : undefined}
        className={isShared ? "pass-row--shared" : undefined}
        id={id}
        color={color}
        time={time}
        sub={sub}
        now={underWay(pass, nowMs)}
        name={track?.shortName ?? ""}
        tag={isShared ? <span className="pass-card__tag">shared</span> : null}
        detail={detailOf(pass)}
        rating={<QualityBadge pass={pass} rating={rating} maxShown pill />}
        open={row.key === openKey}
        onToggle={(button) => toggleRow(row.key, button)}
      >
        {track && observer && (
          <PassRowOpen
            id={id}
            name={track.shortName}
            track={track as unknown as HomeTrack}
            pass={pass}
            observer={observer}
            mode={mode}
            minElevDeg={minElevDeg}
            nowMs={nowMs}
            clouds={clouds}
            openChart={(kind, _track, p, e) => openChart(kind, p as unknown as Pass, e)}
            onSatPage
            links={{
              share: () => linkFor(pass.peakMs, null),
              remind: () => linkFor(pass.peakMs, null),
              calendar: () => addToCalendar(row.pass, row.inProgress),
            }}
          >
            <p className="note note--sm pass-open__notes">
              {row.runsPastEnd && <span className="pass-card__tag">continues past the {DEFAULT_SEARCH_DAYS}-day search</span>}
              <span>{bearings(row.pass as Pass & { startAzDeg: number; endAzDeg: number })}</span>
            </p>
            {row.key === oldNote?.key && <p className="note note--sm">{oldNote.text}</p>}
          </PassRowOpen>
        )}
      </PassRow>
    );
  };

  const showPrompt = !shared && hydrated && (!location || changingLocation);

  return (
    <section id="passes" className="sat-passes" aria-labelledby="sat-passes-title">
      <div className="sat-passes__head">
        <h2 id="sat-passes-title" className="heading-section">{joint ? "Passes everyone can see" : shared && observer ? `Passes from ${observer.name}` : "Passes from your location"}</h2>
        {view?.kind === "rows" && (
          <Button size="sm" className="sat-print-chip" onClick={() => window.print()}>Print</Button>
        )}
      </div>
      {!track ? (
        <p className="note">{UNAVAILABLE}</p>
      ) : (
        <>
          {showPrompt ? (
            <LocationPrompt
              onDone={() => setChangingLocation(false)}
              onCancel={location ? () => setChangingLocation(false) : undefined}
            />
          ) : (
            <HomeControls
              ready={shared || hydrated}
              mode={mode}
              minElevDeg={minElevDeg}
              skyType={skyType}
              locationName={location && !shared ? location.name : null}
              onModeChange={onModeChange}
              onMinElevChange={onMinElevChange}
              onSkyTypeChange={onSkyTypeChange}
              onChangeLocation={() => setChangingLocation(true)}
            />
          )}
          {observer && !showPrompt && (shared ? <ExtraObservers readOnly observers={extra} /> : <ExtraObservers />)}
          {observer && !showPrompt && (!view ? (
            <p className="note" role="status">Finding passes...</p>
          ) : (
            <>
              {busy && <p className="note" role="status">Finding passes...</p>}
              {placesText && (
                <div className="sat-places-line" role="status">
                  <p>{placesText}</p>
                  {!shared && <Button size="sm" onClick={clearObservers}>Turn off</Button>}
                </div>
              )}
              {sharedHit?.kind === "past" && <p className="note sat-shared-past">{sharedHit.text}</p>}
              {view.kind === "rows" && (
                <p className="print-only sat-print-meta">
                  {`Location: ${observers.map((o) => o.name).join(", ")}. Mode: ${mode}. Minimum elevation: ${minElevDeg}°. Times are ${zone}.`}
                </p>
              )}
              {view.kind === "rows" && mode === "radio" && track && (() => {
                // On paper there is no radio chart: say what to listen and transmit on.
                const link = (defaultDownlink as (t: unknown) => { hz: number; mode?: string | null; uplink?: { hz: number; mode?: string; tone?: number; highHz?: number; invert?: boolean } } | null)(track);
                if (!link) return null;
                const up = link.uplink ? (uplinkText as (u: unknown) => string | null)(link.uplink) : null;
                return (
                  <p className="print-only sat-print-meta">
                    {`Listen ${(link.hz / 1e6).toFixed(3)} MHz${link.mode ? ` ${link.mode.toUpperCase()}` : ""}${up ? `. ${up.replace(/^Uplink/, "Transmit")}` : ""}. Doppler shifts these by a few kHz during a pass.`}
                  </p>
                );
              })()}
              {view.kind === "rows" && (() => {
                const note = (printAccuracyNote as (rows: Row[]) => string | null)(view.rows);
                return note ? <p className="print-only sat-print-meta">{note}</p> : null;
              })()}
              {view.kind === "rows" && (
                <table className="print-only sat-print-table">
                  <thead>
                    <tr>
                      {["Day", "Start", "End", "Duration", "Max", "From", "To", "Visible"].map((h) => <th key={h} scope="col">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((row) => {
                      const [from, to] = row.azLabel.split(" to ");
                      return (
                        <tr key={row.key}>
                          <td>{row.dayLabel}</td>
                          <td>{row.startLabel}</td>
                          <td>{row.endLabel}</td>
                          <td>{row.durationLabel}</td>
                          <td>{row.maxElevLabel}</td>
                          <td>{from}</td>
                          <td>{to}</td>
                          <td>{row.visible ? "yes" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {view.kind === "rows" && <p className="note note--sm sat-zone" suppressHydrationWarning>{`Times are ${zone}.`}</p>}
              {view.kind === "rows" ? (
                <>
                <div className="sat-passlist">
                  {groups.map((group) => (
                    <div key={group.heading} className="pass-list__group">
                      <h3 className="heading-group pass-list__day">{group.heading}</h3>
                      <ul className={passRowsClass}>{group.rows.map(passRow)}</ul>
                    </div>
                  ))}
                </div>
                {view.rows.length > rowCount && (
                  <Button size="sm" className="sat-show-all" onClick={() => setShowAll(true)}>
                    {`Show all ${view.rows.length} passes`}
                  </Button>
                )}
                </>
              ) : (
                <>
                  <p className="note">{view.text}</p>
                  {/* Never sets here: no pass to chart, so chart the next 24 hours. */}
                  {alwaysUp && (
                    <div className="sat-day-charts">
                      <Button size="sm" onClick={(e) => openChart("radio", dayPass(alwaysUp), e)}>Radio chart, next 24 h</Button>
                      <Button size="sm" onClick={(e) => openChart("sky", dayPass(alwaysUp), e)}>Sky chart, next 24 h</Button>
                    </div>
                  )}
                </>
              )}
              {view.kind === "rows" && (
                <p className="print-only sat-print-foot" suppressHydrationWarning>
                  {`Printed from seeksat.com on ${printDate(bucketMs, observer.tz ?? "UTC")}. Times are for ${observers.map((o) => o.name).join(", ")}.`}
                </p>
              )}
            </>
          ))}
          {chartsLoaded && (
            <PassChartModals
              subject={subject}
              chart={chart}
              onChartChange={setChart}
              onClose={onClose}
              preferredFreqHz={preferredFreqHz}
              onFreqChange={onFreqChange}
            />
          )}
        </>
      )}
    </section>
  );
}
