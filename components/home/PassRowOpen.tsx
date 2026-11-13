"use client";

import { useMemo } from "react";
import Link from "next/link";
import PolarPlotSvg from "@/components/passes/PolarPlotSvg";
import { RadioPanel, aboveTenText } from "@/components/passes/PassPath";
import { passTime } from "@/components/passes/PassStats";
import { peakMagText } from "@/components/passes/QualityBadge";
import CloudBadge, { passCloud } from "@/components/passes/CloudBadge";
import AlertBell from "@/components/AlertBell";
import ShareButton from "@/components/sat/ShareButton";
import Button from "@/components/ui/Button";
import { compass as compassOf } from "@/lib/sat/pass-rows.mjs";
import { passPath } from "@/lib/passes/pass-words.mjs";
import { markFromList } from "@/lib/home/list-origin.mjs";
import { useHomeStore } from "@/lib/home/store";
import { buttonClass } from "@/lib/ui/classes.mjs";
import type { Forecast } from "@/lib/sky/use-clouds";
import {
  ElementTags, FollowChip, downloadPassIcs, isPasted, liveOk, passShareUrl, reminderUrl, usePassPlot,
  type HomeObserver, type OpenChart, type Pass, type Track, type ViewingProps,
} from "./NextUpList";
import Icon from "@/components/ui/Icon";

const compass = compassOf as (azDeg: number) => string;
type PathStep = { key: "start" | "peak" | "end"; label: string; ms: number };
const pathOf = passPath as (pass: Pass, o: { mode: string; minElevDeg: number; nowMs?: number }) => PathStep[];

/** "6:29 PM, SW", or "6:32 PM, 54° S" with a height: a time and, when known, the compass point. */
function at(ms: number, azDeg: number | null | undefined, timeZone?: string, elevDeg?: number): string {
  const where = [elevDeg != null ? `${Math.round(elevDeg)}°` : null, azDeg != null ? compass(azDeg) : null]
    .filter(Boolean).join(" ");
  return where ? `${passTime(ms, timeZone)}, ${where}` : passTime(ms, timeZone);
}

/** The "{name} page" link, for a satellite that has a page. */
export function SatPageLink({ track, name }: { track: Track; name: string }) {
  if (isPasted(track)) return null;
  return (
    <Link className={`pass-open__page ${buttonClass({ variant: "link", size: "sm" })}`} href={`/sat/${track.noradId}`} onClick={markFromList}>
      {`${name} page`}<Icon name="chevron-right" />
    </Link>
  );
}

/** An opened pass row: the sky plot and where to look, then what to do. */
export default function PassRowOpen({
  id, name, track, pass, observer, mode, minElevDeg, nowMs, clouds, viewing, onUnfollow, openChart, best,
}: {
  id: string;
  name: string;
  track: Track;
  pass: Pass;
  observer: HomeObserver;
  mode: "radio" | "visual";
  minElevDeg: number;
  nowMs: number;
  clouds: Forecast | null;
  /** Set for the viewed (not followed) satellite: Follow replaces Unfollow. */
  viewing: ViewingProps | null;
  onUnfollow: () => void;
  openChart: OpenChart;
  /** This is the best pass in the next 24 hours. */
  best: boolean;
}) {
  const svgRef = usePassPlot(track, observer, pass, nowMs);
  const banded = useHomeStore((st) => st.prefs.bands) != null;
  const visual = mode === "visual";
  const tz = observer.tz;
  const mag = visual ? peakMagText(pass) : null;
  const cloud = visual ? passCloud(clouds, pass, nowMs) : null;
  const shareable = !isPasted(track);
  // The start and end words as the path strip says them: "Appears" and
  // "Fades" at the shadow's edge, "Above 10°" with a minimum set, and no
  // start for a pass already up. The peak always reads "Highest".
  const steps = pathOf(pass, { mode, minElevDeg, nowMs });
  const start = steps.find((st) => st.key === "start");
  const end = steps.find((st) => st.key === "end");
  const aboveTen = visual ? null : aboveTenText(pass);

  const skyButton = (variant?: "quiet") => (
    <Button size="sm" variant={variant} onClick={(e) => openChart("sky", track, pass, e)}>Sky chart</Button>
  );
  const radioButton = (variant?: "quiet") => (
    <Button size="sm" variant={variant} onClick={(e) => openChart("radio", track, pass, e)}>Radio chart</Button>
  );

  return (
    <div id={id} className="pass-open">
      <div className="pass-open__sky">
        <div className="pass-open__plot">
          <PolarPlotSvg ref={svgRef} />
        </div>
        <div className="pass-open__facts">
          <dl className="kv pass-open__steps">
            {start && <div><dt>{start.label}</dt><dd>{at(start.ms, pass.startAzDeg, tz)}</dd></div>}
            <div><dt>Highest</dt><dd>{at(pass.peakMs, pass.peakAzDeg, tz, pass.maxElevDeg)}</dd></div>
            {end && <div><dt>{end.label}</dt><dd>{at(end.ms, pass.endAzDeg, tz)}</dd></div>}
          </dl>
          {visual && (mag || cloud) && (
            <p className="pass-open__seen rating-pair">
              {mag && <span>{mag}</span>}
              <CloudBadge forecast={clouds} pass={pass} nowMs={nowMs} />
            </p>
          )}
          {/* Radio: time above 10°, and whether it can also be seen by eye. */}
          {!visual && (aboveTen || pass.visible) && (
            <p className="pass-open__seen">
              {aboveTen && <span>{aboveTen}</span>}
              {pass.visible && <span className="pass-card__tag">visible</span>}
            </p>
          )}
        </div>
      </div>
      {!visual && (
        <RadioPanel track={track} observer={observer} pass={pass} nowMs={nowMs} banded={banded} onMore={(e) => openChart("radio", track, pass, e)} />
      )}
      <div className="pass-open__actions">
        {liveOk(pass, nowMs) && (
          <Button size="sm" variant="primary" onClick={(e) => openChart("live", track, pass, e)}>
            <span className="live-dot" aria-hidden="true" />Live
          </Button>
        )}
        {visual ? skyButton() : radioButton()}
        <AlertBell noradId={track.noradId} name={track.shortName} pass={pass} url={reminderUrl(track)} />
        {shareable && (
          <ShareButton
            url={() => passShareUrl({ track, observer, pass, mode, minElevDeg }) ?? ""}
            title={`${name} from ${observer.name}`}
          />
        )}
        <SatPageLink track={track} name={name} />
      </div>
      <div className="pass-open__more">
        {visual ? radioButton("quiet") : skyButton("quiet")}
        <Button size="sm" variant="quiet" title="Add to calendar" onClick={() => downloadPassIcs({ track, observer, pass, mode, minElevDeg })}>
          <Icon name="calendar" /> Calendar
        </Button>
        <ElementTags track={track} nowMs={nowMs} />
        <FollowChip viewing={viewing} onUnfollow={onUnfollow} />
        {best && <span className="pass-open__best">Best pass in the next 24 hours</span>}
      </div>
    </div>
  );
}

const DAY_MS = 86_400_000;

/** An opened "Always up" row: in radio mode what to listen on over the next
 *  24 hours, then the satellite's page. */
export function AlwaysRowOpen({ id, name, track, pointing, observer, mode, nowMs, viewing, onUnfollow, openChart }: {
  id: string;
  name: string;
  track: Track;
  pointing: { azDeg: number; elDeg: number };
  observer: HomeObserver;
  mode: "radio" | "visual";
  nowMs: number;
  viewing: ViewingProps | null;
  onUnfollow: () => void;
  openChart: OpenChart;
}) {
  const banded = useHomeStore((st) => st.prefs.bands) != null;
  const minute = Math.floor(nowMs / 60_000);
  // The 24 hours from now, shaped as a pass, for a satellite that never sets;
  // rebuilt each minute so the Doppler figures keep their memo between ticks.
  const dayPass = useMemo<Pass>(() => {
    const startMs = minute * 60_000;
    return {
      day: true, startMs, endMs: startMs + DAY_MS, peakMs: startMs, durationMs: DAY_MS,
      maxElevDeg: pointing.elDeg, startAzDeg: pointing.azDeg, endAzDeg: null, visible: false, inProgress: true,
    };
  }, [minute, pointing.azDeg, pointing.elDeg]);

  return (
    <div id={id} className="pass-open">
      {mode === "radio" && (
        <RadioPanel track={track} observer={observer} pass={dayPass} nowMs={nowMs} banded={banded} onMore={(e) => openChart("radio", track, dayPass, e)} />
      )}
      <div className="pass-open__more">
        <ElementTags track={track} nowMs={nowMs} />
        <FollowChip viewing={viewing} onUnfollow={onUnfollow} />
        <SatPageLink track={track} name={name} />
      </div>
    </div>
  );
}
