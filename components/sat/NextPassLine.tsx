import QualityBadge, { visualRating, type RatedPass } from "@/components/passes/QualityBadge";
import CloudBadge, { passCloud } from "@/components/passes/CloudBadge";
import type { Forecast } from "@/lib/sky/use-clouds";
import { nextPassText } from "@/lib/sat/pass-rows.mjs";
import type { NextPass, NextPassReport, PassSectionHandle } from "./PassSection";

type LinePass = NextPass & RatedPass & { peakMs: number; startAzDeg: number; endAzDeg: number };
const textOf = nextPassText as (pass: LinePass, nowMs: number, timeZone?: string, locale?: string) => string | null;

/**
 * "Next pass: Tomorrow 04:12, SW to SE, Low Cloudy" with a chart button that
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
      <p className="sat-next__text">
        <span className="sat-next__label">Next pass:</span>{" "}
        <span className="sat-next__what">
          {`${text}, `}
          <span className="rating-pair">
            <QualityBadge pass={pass} rating={rating} />
            {visual && <>{" "}<CloudBadge forecast={clouds} pass={pass} nowMs={nowMs} /></>}
          </span>
        </span>
      </p>
      <button type="button" className="home-chip" onClick={(e) => onChart(visual ? "sky" : "radio", pass, e)}>
        {visual ? "Sky chart" : "Radio chart"}
      </button>
    </div>
  );
}
