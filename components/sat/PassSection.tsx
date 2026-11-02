"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import HomeControls from "@/components/home/HomeControls";
import ExtraObservers from "@/components/sat/ExtraObservers";
import LocationPrompt from "@/components/home/LocationPrompt";
import type { HomeObserver } from "@/components/home/NextUpList";
import type { ChartSubject } from "@/components/passes/PassChartModals";
import { useHomeStore, type ExtraObserver } from "@/lib/home/store";
import { getPassRunner } from "@/lib/passes/pass-client.mjs";
import { DEFAULT_SEARCH_DAYS } from "@/lib/passes/engine.mjs";
import { passToIcs, icsFileName } from "@/lib/passes/ics.mjs";
import { downloadText } from "@/lib/passes/download.js";
import { passRows, printAccuracyNote, zoneLabel, initialRowCount, groupRowsByDay, isRowOpen, directionText } from "@/lib/sat/pass-rows.mjs";
import QualityBadge from "@/components/passes/QualityBadge";
import CloudBadge from "@/components/passes/CloudBadge";
import type { Forecast } from "@/lib/sky/use-clouds";
import { liveAvailable } from "@/lib/live/live-state.mjs";
import { passJobKey } from "@/lib/passes/job-key.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import AlertBell from "@/components/AlertBell";
import ShareButton from "@/components/sat/ShareButton";
import MoreToggle from "@/components/passes/MoreToggle";
import { shareUrl } from "@/lib/share/share-link.mjs";
import { findSharedRow } from "@/lib/sat/shared-view.mjs";

// The chart painters load on the first chart open, not with the page.
const PassChartModals = dynamic(() => import("@/components/passes/PassChartModals"), { ssr: false });

type Pass = { startMs: number; endMs: number; [k: string]: unknown };
/** The first listed pass, as the page's "Next pass" tile reads it. */
export type NextPass = Pass & { peakMs?: number; maxElevDeg?: number };
/** What the search found, for the "Next pass" tile. undefined while searching. */
export type NextPassReport =
  | undefined
  | { kind: "pass"; pass: NextPass }
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
const rowOpen = isRowOpen as (key: string, sharedKey: string | null, toggled: ReadonlySet<string>) => boolean;
const liveOk = liveAvailable as (pass: { startMs: number; endMs: number }, nowMs: number) => boolean;
const groupRows = (rows: Row[], nowMs: number, timeZone?: string) =>
  (groupRowsByDay as (r: Row[], n: number, tz?: string, l?: string) => Array<{ heading: string; rows: Row[] }>)(rows, nowMs, timeZone);
const toIcs = passToIcs as unknown as (o: Record<string, unknown>) => string;
const icsName = icsFileName as (sat: string, place: string, startMs: number) => string;
type SharedHit = { kind: "row"; key: string } | { kind: "past"; text: string } | null;
const sharedRowOf = findSharedRow as (
  rows: Row[], passTimeMs: number | null, nowMs: number, o: { timeZone?: string; locale?: string },
) => SharedHit;

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
}

export default function PassSection({
  track: trackIn, record, epochMs, nowMs, settings, onModeChange, onMinElevChange,
  sharedPassMs = null, preferredFreqHz = null, onFreqPicked, onNextPass, clouds = null,
}: Props) {
  const track = trackIn as Track | null;
  const hydrated = useHomeStore((s) => s.hydrated);
  const [changingLocation, setChangingLocation] = useState(false);
  const shared = settings.isShared;
  const { mode, minElevDeg } = settings;

  const location = settings.observer;
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

  const extra = settings.observers;
  const observers = useMemo<HomeObserver[]>(
    () => observer
      ? [observer, ...extra.map((o) => ({ ...o, tz: observer.tz, elevM: 0, elevSource: "default" }))]
      : [],
    [observer, extra],
  );
  const joint = extra.length > 0;
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

  // Report the first row, or why there is none, to the "Next pass" tile.
  // Read from the raw result so a stationary or failed search says so.
  const firstPass = view && view.kind === "rows" ? (view.rows[0].pass as NextPass) : null;
  const nextReport = useMemo<NextPassReport>(() => {
    if (!track) return { kind: "unavailable" };
    if (!observer) return undefined;
    if (failed) return { kind: "failed" };
    if (!result) return undefined;
    const r = result as { kind?: string; visible?: boolean; pointing?: unknown[] };
    if (r.kind === "unavailable") return { kind: "unavailable" };
    if (r.kind === "stationary") return r.pointing?.[0] ? { kind: "stationary", visible: Boolean(r.visible) } : { kind: "unavailable" };
    return firstPass ? { kind: "pass", pass: firstPass } : { kind: "none" };
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
  // Rows whose More was toggled; the shared row starts open (isRowOpen).
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRow = (key: string) => setOpenRows((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const rowCount = view?.kind === "rows"
    ? (showAll ? view.rows.length : (initialRowCount as (r: Row[], n: number, o: { sharedKey: string | null }) => number)(view.rows, bucketMs, { sharedKey }))
    : 0;
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

  // The subject is captured at open, so the clock never repaints an open chart.
  const [subject, setSubject] = useState<ChartSubject | null>(null);
  const [chart, setChart] = useState<"sky" | "radio" | "live" | null>(null);
  const [chartsLoaded, setChartsLoaded] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  const openChart = (kind: "sky" | "radio" | "live", pass: Pass, e: React.MouseEvent<HTMLButtonElement>) => {
    if (!observer) return;
    trigger.current = e.currentTarget;
    setChartsLoaded(true);
    setSubject({ track, obs: observer, pass, minElevDeg, jointWindow: joint ? { startMs: pass.startMs, endMs: pass.endMs } : null } as unknown as ChartSubject);
    setChart(kind);
  };
  const onClose = useCallback(() => {
    setChart(null);
    trigger.current?.focus();
  }, []);

  const pickedFreq = useRef<number | null>(preferredFreqHz);
  const onFreqChange = useCallback((hz: number | null) => {
    pickedFreq.current = hz;
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

  const showPrompt = !shared && hydrated && (!location || changingLocation);

  return (
    <section id="passes" className="sat-passes" aria-labelledby="sat-passes-title">
      <div className="sat-passes__head">
        <h2 id="sat-passes-title" className="home-heading">{joint ? "Passes everyone can see" : shared && observer ? `Passes from ${observer.name}` : "Passes from your location"}</h2>
        {view?.kind === "rows" && (
          <button type="button" className="home-chip sat-print-chip" onClick={() => window.print()}>Print</button>
        )}
      </div>
      {!track ? (
        <p className="home-note">{UNAVAILABLE}</p>
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
              locationName={location && !shared ? location.name : null}
              onModeChange={onModeChange}
              onMinElevChange={onMinElevChange}
              onChangeLocation={() => setChangingLocation(true)}
            />
          )}
          {observer && !showPrompt && (shared ? <ExtraObservers readOnly observers={extra} /> : <ExtraObservers />)}
          {observer && !showPrompt && (!view ? (
            <p className="home-note" role="status">Finding passes...</p>
          ) : (
            <>
              {busy && <p className="home-note" role="status">Finding passes...</p>}
              {sharedHit?.kind === "past" && <p className="home-note sat-shared-past">{sharedHit.text}</p>}
              {view.kind === "rows" && (
                <p className="print-only sat-print-meta">
                  {`Location: ${observers.map((o) => o.name).join(", ")}. Mode: ${mode}. Minimum elevation: ${minElevDeg}°. Times are ${zone}.`}
                </p>
              )}
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
              {view.kind === "rows" && <p className="home-note sat-zone" suppressHydrationWarning>{`Times are ${zone}.`}</p>}
              {view.kind === "rows" ? (
                <>
                <div className="sat-passlist">
                  {groupRows(view.rows.slice(0, rowCount), bucketMs, observer?.tz).map((group) => (
                    <section key={group.heading} className="sat-day-group">
                      <h3 className="sat-day">{group.heading}</h3>
                      <ul className="sat-day__list">
                        {group.rows.map((row) => {
                          const open = rowOpen(row.key, sharedKey, openRows);
                          const moreId = `pass-more-${row.key}`;
                          return (
                            <li
                              key={row.key}
                              ref={row.key === sharedKey ? sharedRow : undefined}
                              className={row.key === sharedKey ? "sat-pass pass-row--shared" : "sat-pass"}
                            >
                              <p className="sat-pass__line1">
                                <span className="sat-pass__times">{row.timesLabel}</span>
                                <QualityBadge pass={row.pass as NextPass} />
                                {mode === "visual" && (
                                  <CloudBadge forecast={clouds} pass={row.pass as NextPass & { peakMs: number }} nowMs={bucketMs} />
                                )}
                                <span className="sat-pass__max">{`max ${row.maxElevLabel}`}</span>
                              </p>
                              <p className="sat-pass__line2">
                                <span title={row.azLabel}>{`${row.durationLabel} · ${row.fromLabel} → ${row.toLabel}`}</span>
                                {row.key === sharedKey && <span className="pass-card__tag">shared pass</span>}
                                {row.visible && <span className="pass-card__tag">visible</span>}
                                {row.runsPastEnd && <span className="pass-card__tag">continues past the {DEFAULT_SEARCH_DAYS}-day search</span>}
                              </p>
                              {row.accuracy && <p className="sat-how">{row.accuracy}</p>}
                              <div className="pass-card__actions">
                                {liveOk(row.pass, bucketMs) && (
                                  <button type="button" className="home-chip home-chip--live" onClick={(e) => openChart("live", row.pass, e)}>Live</button>
                                )}
                                <button type="button" className="home-chip" onClick={(e) => openChart("sky", row.pass, e)}>Sky chart</button>
                                <MoreToggle
                                  id={moreId}
                                  open={open}
                                  onToggle={() => toggleRow(row.key)}
                                  label={`the ${row.timesLabel} pass`}
                                >
                                  <p className="more-panel__note">{bearings(row.pass as Pass & { startAzDeg: number; endAzDeg: number })}</p>
                                  <button type="button" className="home-chip" onClick={(e) => openChart("radio", row.pass, e)}>Radio chart</button>
                                  {track && (
                                    <ShareButton
                                      url={() => linkFor((row.pass as { peakMs?: number }).peakMs ?? null, pickedFreq.current)}
                                      title={`${track.name} pass`}
                                    />
                                  )}
                                  <button type="button" className="home-chip" aria-label="Add to calendar" title="Add to calendar" onClick={() => addToCalendar(row.pass, row.inProgress)}>
                                    {"📅"}
                                  </button>
                                  {track && (
                                    <AlertBell
                                      noradId={track.noradId}
                                      name={track.shortName}
                                      pass={row.pass as NextPass}
                                      url={() => linkFor((row.pass as { peakMs?: number }).peakMs ?? null, null)}
                                    />
                                  )}
                                </MoreToggle>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
                {view.rows.length > rowCount && (
                  <button type="button" className="home-chip sat-show-all" onClick={() => setShowAll(true)}>
                    {`Show all ${view.rows.length} passes`}
                  </button>
                )}
                </>
              ) : (
                <p className="home-note">{view.text}</p>
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
