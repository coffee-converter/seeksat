import QualityBadge, { visualRating, type RatedPass } from "@/components/passes/QualityBadge";
import CloudBadge, { passCloud } from "@/components/passes/CloudBadge";
import type { Forecast } from "@/lib/sky/use-clouds";
import { nextPassText, nextPassWhen as whenOf } from "@/lib/sat/pass-rows.mjs";
import type { NextPass, NextPassReport, PassSectionHandle } from "./PassSection";

type LinePass = NextPass & RatedPass & { peakMs: number; startAzDeg: number; endAzDeg: number };
const textOf = nextPassText as (pass: LinePass, nowMs: number, timeZone?: string, locale?: string) => string | null;

/** The time words alone, "in 27 min" or "up now", for the drawer's title bar. */
export function nextPassWhen(report: NextPassReport, nowMs: number): string | null {
  if (report?.kind !== "pass") return null;
  return whenOf(report.pass, nowMs) as string | null;
}

/**
 * "Next pass: Tomorrow 4:12 AM, SW to SE" and the rating pill, with a chart button that
 * follows the mode, right under the satellite page's title. Same day words,
 * clock and badges as the pass rows. Hidden when there is no upcoming pass.
 */
export default function NextPassLine({ report, nowMs, mode, skyType, clouds, onChart }: {
  report: NextPassReport;
  nowMs: number;
  mode: "radio" | "visual";
  skyType: string;
  clouds: Forecast | null;
  onChart: PassSectionHandle["openChart"];
}) {
  if (report?.kind !== "pass") return null;
  const pass = report.pass as LinePass;
  const text = textOf(pass, nowMs, report.timeZone);
  if (!text) return null;
  const visual = mode === "visual";
  const rating = visual ? visualRating(pass, { skyType, cloud: passCloud(clouds, pass, nowMs) }) : undefined;
  return (
    <div className="sat-next">
      {/* The sentence, then the rating on its own line under it, flush left. */}
      <div className="sat-next__main">
        <p className="sat-next__text">
          <span className="sat-next__label">Next pass:</span>{" "}
          {/* No-break space keeps "4:12 AM" together. */}
          <span className="sat-next__what">{text.replace(/ (AM|PM)\b/g, "\u00a0$1")}</span>
        </p>
        <span className="rating-pair rating-pill sat-next__rating">
          <QualityBadge pass={pass} rating={rating} />
          {visual && <CloudBadge forecast={clouds} pass={pass} nowMs={nowMs} />}
        </span>
      </div>
      <button type="button" className="home-chip" onClick={(e) => onChart(visual ? "sky" : "radio", pass, e)}>
        {visual ? "Sky chart" : "Radio chart"}
      </button>
    </div>
  );
}
