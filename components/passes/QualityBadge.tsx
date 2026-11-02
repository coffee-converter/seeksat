import { passQuality } from "@/lib/passes/quality.mjs";

type Quality = { level: "good" | "ok" | "low"; label: string; reason: string };

/** Good, OK or Low for a pass: always a word, the colour only backs it up. */
export default function QualityBadge({ pass }: { pass: { maxElevDeg?: number } }) {
  const q = (passQuality as (p: { maxElevDeg?: number }) => Quality)(pass);
  return <span className={`quality quality--${q.level}`} title={q.reason}>{q.label}</span>;
}
