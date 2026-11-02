import { passQuality } from "@/lib/passes/quality.mjs";
import { formatMag, visualQuality } from "@/lib/sky/visual-rating.mjs";
import type { CloudBadge } from "@/lib/sky/cloud-badge.mjs";

export type Quality = { level: "good" | "ok" | "low"; label: string; reason: string };
/** What the visual rating reads from a pass (the engine sets these in visual mode). */
export type RatedPass = {
  maxElevDeg?: number;
  peakMag?: number | null;
  peakMagSunAltDeg?: number | null;
  peakSunAltDeg?: number | null;
};

/** The visual-mode rating: brightness against sky darkness, then cloud. */
export const visualRating = visualQuality as (
  pass: RatedPass,
  o: { skyType: string; cloud: CloudBadge | null },
) => Quality;

/** "mag −2.1" for a pass with a known peak magnitude, else null. */
export function peakMagText(pass: RatedPass): string | null {
  return pass.peakMag == null ? null : `mag ${(formatMag as (m: number) => string)(pass.peakMag)}`;
}

/** Good, OK or Low for a pass: always a word, the colour only backs it up.
 *  `rating` (visual mode) replaces the elevation-only rating. */
export default function QualityBadge({ pass, rating }: { pass: { maxElevDeg?: number }; rating?: Quality }) {
  const q = rating ?? (passQuality as (p: { maxElevDeg?: number }) => Quality)(pass);
  return <span className={`quality quality--${q.level}`} title={q.reason}>{q.label}</span>;
}
