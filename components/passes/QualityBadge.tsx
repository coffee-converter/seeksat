import { passQuality } from "@/lib/passes/quality.mjs";
import { formatMag, visualQuality } from "@/lib/sky/visual-rating.mjs";
import { ratingShort } from "@/lib/passes/pass-words.mjs";
import type { CloudBadge } from "@/lib/sky/cloud-badge.mjs";

/** `cause` (visual ratings only) is what held the rating below Good. */
export type Quality = { level: "good" | "ok" | "low"; label: string; reason: string; cause?: string | null; bars?: number };
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

const shortOf = ratingShort as (q: Quality, pass: { maxElevDeg?: number }, o: { mode: string }) => string | null;

/** "Poor: faint" or "Great": the badge's words, for a bar's tooltip and label.
 *  `maxShown`: a Max column beside it already says "N° up", so leave it out. */
export function ratingText(
  q: Pick<Quality, "level" | "label" | "cause">, pass: { maxElevDeg?: number }, visual: boolean, maxShown = false,
): string {
  if (maxShown && q.cause === "low") return q.label;
  const short = shortOf(q as Quality, pass, { mode: visual ? "visual" : "radio" });
  return short ? `${q.label}: ${short}` : q.label;
}

const BAR_COUNT = 5;

/** Poor, Fair, Good, Great or Excellent for a pass, after 1 to 5 signal bars:
 *  one word per bar count. The word and the bars carry it; the colour (red to
 *  green) only backs them up. Below Good it says why in a few words ("Poor:
 *  faint", "Fair: 14° up"); the
 *  tooltip keeps the full reason. `rating` (visual mode) replaces the
 *  elevation-only rating. */
export default function QualityBadge({ pass, rating, maxShown = false }: {
  pass: { maxElevDeg?: number }; rating?: Quality; maxShown?: boolean;
}) {
  const q = rating ?? (passQuality as (p: { maxElevDeg?: number }) => Quality)(pass);
  const bars = Math.min(BAR_COUNT, Math.max(1, Math.round(q.bars ?? 1)));
  return (
    <span className={`quality quality--${q.level} quality--b${bars}`} title={q.reason}>
      <span className="qbars" aria-hidden="true">
        {Array.from({ length: BAR_COUNT }, (_, i) => <i key={i} className={i < bars ? "on" : undefined} />)}
      </span>
      {ratingText(q, pass, !!rating, maxShown)}
      <span className="sr-only">{`, ${bars} of ${BAR_COUNT}`}</span>
    </span>
  );
}
