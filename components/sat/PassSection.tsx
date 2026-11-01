"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import HomeControls from "@/components/home/HomeControls";
import LocationPrompt from "@/components/home/LocationPrompt";
import type { HomeObserver } from "@/components/home/NextUpList";
import type { ChartSubject } from "@/components/passes/PassChartModals";
import { useHomeStore } from "@/lib/home/store";
import { getPassRunner } from "@/lib/passes/pass-client.mjs";
import { DEFAULT_SEARCH_DAYS } from "@/lib/passes/engine.mjs";
import { passToIcs, icsFileName } from "@/lib/passes/ics.mjs";
import { downloadText } from "@/lib/passes/download.js";
import { passRows } from "@/lib/sat/pass-rows.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";

// The chart painters load on the first chart open, not with the page.
const PassChartModals = dynamic(() => import("@/components/passes/PassChartModals"), { ssr: false });

type Pass = { startMs: number; endMs: number; [k: string]: unknown };
type Row = {
  key: string; dayLabel: string; startLabel: string; peakLabel: string; endLabel: string;
  durationLabel: string; maxElevLabel: string; azLabel: string;
  visible: boolean; inProgress: boolean; runsPastEnd: boolean; accuracy: string | null; pass: Pass;
};
type View =
  | { kind: "rows"; rows: Row[] }
  | { kind: "message" | "stationary"; text: string };
type Track = { name: string; shortName: string; noradId: number };

const rowsOf = passRows as unknown as (r: unknown, o: Record<string, unknown>) => View;
const toIcs = passToIcs as unknown as (o: Record<string, unknown>) => string;
const icsName = icsFileName as (sat: string, place: string, startMs: number) => string;

const UNAVAILABLE = "These elements can't be used to compute passes.";

interface Props {
  track: unknown;
  record: unknown;
  epochMs: number;
  nowMs: number;
}

export default function PassSection({ track: trackIn, record, epochMs, nowMs }: Props) {
  const track = trackIn as Track | null;
  const prefs = useHomeStore((s) => s.prefs);
  const hydrated = useHomeStore((s) => s.hydrated);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const [changingLocation, setChangingLocation] = useState(false);

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

  const [result, setResult] = useState<unknown>(null);
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
      setResult(null);
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
        observers: [observer],
        mode: prefs.mode,
        minElevDeg: prefs.minElevDeg,
        startMs,
        endMs: startMs + DEFAULT_SEARCH_DAYS * 86_400_000,
      })
      .then((r: unknown) => {
        if (mine !== request.current) return;
        inFlight.current = false;
        setBusy(false);
        setResult(r);
      })
      .catch((e: unknown) => {
        if (mine !== request.current) return;
        inFlight.current = false;
        setBusy(false);
        setFailed(true);
        console.warn("Pass search failed.", e);
      });
  }, [track, record, observer, prefs.mode, prefs.minElevDeg, tick]);

  const view = useMemo<View | null>(() => {
    if (failed) return { kind: "message", text: UNAVAILABLE };
    if (!result || !observer) return null;
    return rowsOf(result, {
      epochMs,
      minElevDeg: prefs.minElevDeg,
      mode: prefs.mode,
      timeZone: observer.tz,
      locale: undefined,
    });
  }, [result, failed, observer, epochMs, prefs.minElevDeg, prefs.mode]);

  // Search again once the first pass has ended (never while a job runs, and
  // never after a failure).
  const firstEnd = view && view.kind === "rows" ? view.rows[0].pass.endMs : null;
  useEffect(() => {
    if (firstEnd != null && !failed && !inFlight.current && nowMs >= firstEnd) setTick((t) => t + 1);
  }, [nowMs, firstEnd, failed]);

  // The subject is captured at open, so the clock never repaints an open chart.
  const [subject, setSubject] = useState<ChartSubject | null>(null);
  const [chart, setChart] = useState<"sky" | "radio" | null>(null);
  const [chartsLoaded, setChartsLoaded] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  const openChart = (kind: "sky" | "radio", pass: Pass, e: React.MouseEvent<HTMLButtonElement>) => {
    if (!observer) return;
    trigger.current = e.currentTarget;
    setChartsLoaded(true);
    setSubject({ track, obs: observer, pass, minElevDeg: prefs.minElevDeg, jointWindow: null } as unknown as ChartSubject);
    setChart(kind);
  };
  const onClose = useCallback(() => {
    setChart(null);
    trigger.current?.focus();
  }, []);

  const addToCalendar = (pass: Pass) => {
    if (!observer || !track) return;
    const ics = toIcs({
      satName: track.name,
      noradId: track.noradId,
      observer: { name: observer.name, latDeg: observer.latDeg, lonDeg: observer.lonDeg },
      pass,
      mode: prefs.mode,
      nowMs: trueNow(),
      url: null,
      observerCount: 1,
      inProgress: Boolean(pass.inProgress),
    });
    downloadText(ics, icsName(track.shortName, observer.name, pass.startMs), "text/calendar");
  };

  const showPrompt = hydrated && (!location || changingLocation);

  return (
    <section id="passes" className="sat-passes" aria-labelledby="sat-passes-title">
      <h2 id="sat-passes-title" className="home-heading">Passes from your location</h2>
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
              ready={hydrated}
              mode={prefs.mode}
              minElevDeg={prefs.minElevDeg}
              locationName={location ? location.name : null}
              onModeChange={(mode) => setPrefs({ mode })}
              onMinElevChange={(minElevDeg) => setPrefs({ minElevDeg })}
              onChangeLocation={() => setChangingLocation(true)}
            />
          )}
          {observer && !showPrompt && (busy && !view ? (
            <p className="home-note" role="status">Finding passes...</p>
          ) : view && (
            <>
              {busy && <p className="home-note" role="status">Finding passes...</p>}
              {view.kind === "rows" ? (
                <ul className="sat-passlist">
                  {view.rows.map((row) => (
                    <li key={row.key} className="sat-pass">
                      <p className="sat-pass__main">
                        <span className="sat-pass__day">{row.dayLabel}</span>
                        {` ${row.startLabel} to ${row.endLabel}, ${row.durationLabel}, max ${row.maxElevLabel}, ${row.azLabel}`}
                        {row.visible && <span className="pass-card__tag">visible</span>}
                        {row.inProgress && <span className="pass-card__tag">up now</span>}
                        {row.runsPastEnd && <span className="pass-card__tag">continues past the {DEFAULT_SEARCH_DAYS}-day search</span>}
                      </p>
                      {row.accuracy && <p className="sat-how">{row.accuracy}</p>}
                      <div className="pass-card__actions">
                        <button type="button" className="home-chip" onClick={(e) => openChart("sky", row.pass, e)}>Sky chart</button>
                        <button type="button" className="home-chip" onClick={(e) => openChart("radio", row.pass, e)}>Radio chart</button>
                        <button type="button" className="home-chip" aria-label="Add to calendar" title="Add to calendar" onClick={() => addToCalendar(row.pass)}>
                          {"📅"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="home-note">{view.text}</p>
              )}
            </>
          ))}
          {chartsLoaded && (
            <PassChartModals subject={subject} chart={chart} onChartChange={setChart} onClose={onClose} />
          )}
        </>
      )}
    </section>
  );
}
