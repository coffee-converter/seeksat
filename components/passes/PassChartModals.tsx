"use client";

import { useCallback, useState } from "react";
import SkyChartModalView from "@/components/passes/SkyChartModalView";
import RadioChartModalView from "@/components/passes/RadioChartModalView";
import {
  paintSkyChart, passFileName, radioChartOptions, radioCsvText, radioSeries,
} from "@/lib/passes/charts.js";
import { paintRadioChart } from "@/lib/pass-finder/radio-chart.js";
import { svgToPngBlob } from "@/lib/pass-finder/polar-png.js";
import { getClockSkewMs, hasClockSyncSample, trueNow } from "@/lib/pass-finder/clock-sync.js";
import { defaultDownlink } from "@/lib/catalog.mjs";
import type { Track, HomeObserver, Pass } from "@/components/home/NextUpList";

export interface ChartSubject {
  track: Track;
  obs: HomeObserver;
  pass: Pass;
  minElevDeg: number;
  jointWindow: { startMs: number; endMs: number } | null;
}

interface Props {
  subject: ChartSubject | null;
  chart: "sky" | "radio" | null;
  onChartChange: (chart: "sky" | "radio") => void;
  onClose: () => void;
  /** Used instead of the default downlink when the satellite changes (a shared view's frequency). */
  preferredFreqHz?: number | null;
  /** Fired when the user picks a frequency in the radio chart. */
  onFreqChange?: (hz: number | null) => void;
}

// The sky chart and radio chart modals for one pass. Loaded on first use, so
// the painters stay out of the page's first bundle.
export default function PassChartModals({ subject, chart, onChartChange, onClose, preferredFreqHz = null, onFreqChange }: Props) {
  const noradId = subject?.track.noradId ?? null;
  const initialFreq = (s: ChartSubject | null) =>
    s ? preferredFreqHz ?? defaultDownlink(s.track)?.hz ?? null : null;
  const [freqHz, setFreqHz] = useState<number | null>(() => initialFreq(subject));
  // A chosen frequency sticks while the same satellite is reopened; a new
  // satellite resets it to the preferred frequency, else its default downlink.
  const [freqFor, setFreqFor] = useState<number | null>(noradId);
  if (noradId !== freqFor) {
    // Adjusting state during render avoids one paint at the old frequency.
    setFreqFor(noradId);
    setFreqHz(initialFreq(subject));
  }

  const renderSky = useCallback(async (svg: SVGSVGElement) => {
    if (!subject) return null;
    const { track, obs, pass } = subject;
    // tzRefMs undefined: the chart labels the UTC offset at the pass peak.
    paintSkyChart(svg, { track, obs, win: pass, tzRefMs: undefined });
    const blob = await svgToPngBlob(svg);
    return {
      blobUrl: URL.createObjectURL(blob as Blob),
      filename: passFileName(track, obs, pass.peakMs, "sky"),
    };
  }, [subject]);

  const buildRadio = useCallback((purpose: "chart" | "csv") => {
    if (!subject) return null;
    const { track, obs, pass, minElevDeg, jointWindow } = subject;
    const built = radioSeries({
      track, obs, anchorMs: pass.peakMs, minElevDeg, freqHz, jointWindow, purpose,
    });
    return built ? { built, track, obs } : null;
  }, [subject, freqHz]);

  const renderRadio = useCallback(async (svg: SVGSVGElement) => {
    const r = buildRadio("chart");
    if (!r) return null;
    const { built, track, obs } = r;
    paintRadioChart(svg, built.series, radioChartOptions(built, { track, obs }));
    const blob = await svgToPngBlob(svg);
    return {
      blobUrl: URL.createObjectURL(blob as Blob),
      // tcaMs is interpolated, so fractional; round before it names a file.
      filename: passFileName(track, obs, Math.round(built.series.summary.tcaMs), "radio"),
    };
  }, [buildRadio]);

  const radioCsv = () => {
    const r = buildRadio("csv");
    if (!r) return null;
    const { built, track, obs } = r;
    return {
      csv: radioCsvText(built, {
        track,
        obs,
        generatedAtMs: trueNow(),
        // null until a response has measured the skew; the CSV then leaves the line out.
        clockSkewMs: hasClockSyncSample() ? getClockSkewMs() : null,
      }),
      filename: passFileName(track, obs, Math.round(built.series.summary.tcaMs), "radio", "csv"),
    };
  };

  const subjectKey = subject ? `${subject.track.noradId}:${subject.pass.startMs}` : "";
  const subjectName = subject?.track.shortName ?? "";

  return (
    <>
      <SkyChartModalView
        open={chart === "sky" && !!subject}
        title={`Sky chart: ${subjectName} pass`}
        subjectKey={subjectKey}
        render={renderSky}
        onClose={onClose}
        onRadioChart={() => onChartChange("radio")}
      />
      <RadioChartModalView
        open={chart === "radio" && !!subject}
        title={`Radio chart: ${subjectName} pass`}
        subjectKey={subjectKey}
        render={renderRadio}
        csv={radioCsv}
        freqHz={freqHz}
        downlinks={subject?.track.downlinks ?? []}
        onFreqChange={(hz: number | null) => { setFreqHz(hz); onFreqChange?.(hz); }}
        onClose={onClose}
        onSkyChart={() => onChartChange("sky")}
      />
    </>
  );
}
