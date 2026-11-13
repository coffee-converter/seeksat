import { passQuality } from "@/lib/passes/quality.mjs";
import { formatMag, visualQuality } from "@/lib/sky/visual-rating.mjs";
import { ratingShort } from "@/lib/passes/pass-words.mjs";
import type { CloudBadge } from "@/lib/sky/cloud-badge.mjs";
import RatingBars from "@/components/ui/RatingBars";
import Badge from "@/components/ui/Badge";

/** `cause` (visual ratings only) is what held the rating below Good. */
export type Quality = { level: "good" | "ok" | "low"; label: string; reason: string; cause?: string | null; bars?: number };
/** What the visual rating reads from a pass (the engine sets these in visual mode). */
export type RatedPass = {
  maxElevDeg?: number;
  peakMag?: number | null;
  /** The magnitude is a guess (the satellite's size is not known). */
  peakMagEstimated?: boolean;
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
  if (pass.peakMag == null) return null;
  return `${pass.peakMagEstimated ? "est. " : ""}mag ${(formatMag as (m: number) => string)(pass.peakMag)}`;
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
 *  one word per bar count. The word and the bars carry it; the colour (grey to
 *  green) only backs them up. Below Good it says why in a few words ("Poor:
 *  faint", "Fair: 14° up"); the
 *  tooltip keeps the full reason. `rating` (visual mode) replaces the
 *  elevation-only rating. `pill`: a tinted pill, so it reads at a glance
 *  (pass cards, satellite page rows, the next pass line). */
export default function QualityBadge({ pass, rating, maxShown = false, pill = false }: {
  pass: { maxElevDeg?: number }; rating?: Quality; maxShown?: boolean; pill?: boolean;
}) {
  const q = rating ?? (passQuality as (p: { maxElevDeg?: number }) => Quality)(pass);
  const bars = Math.min(BAR_COUNT, Math.max(1, Math.round(q.bars ?? 1)));
  const body = (
    <>
      {/* Bars first on screen, but spoken after the word: "Poor: faint, 3 of 5". */}
      <RatingBars bars={bars as 1 | 2 | 3 | 4 | 5} />
      {ratingText(q, pass, !!rating, maxShown)}
      <span className="sr-only">{`, ${bars} of ${BAR_COUNT}`}</span>
    </>
  );
  return (
    <span className={`quality quality--${q.level} quality--b${bars}`} title={q.reason}>
      {pill ? <Badge tone="rating">{body}</Badge> : body}
    </span>
  );
}
