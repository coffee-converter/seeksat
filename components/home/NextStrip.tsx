import QualityBadge, { type Quality, type RatedPass } from "@/components/passes/QualityBadge";

export interface NextSummary {
  noradId: number;
  name: string;
  text: string;
  pass: RatedPass & { inProgress?: boolean };
}

/**
 * The soonest pass, above the map on phones, where the Next up list is a
 * long scroll away. Hidden once the panel sits beside the map (1100 px).
 * A tap focuses that satellite and brings its card into view.
 */
export default function NextStrip({ summary, rating, onFocus }: {
  summary: NextSummary | null;
  /** Visual mode: the same rating the pass's card shows. */
  rating?: Quality;
  onFocus: (noradId: number) => void;
}) {
  if (!summary) return null;
  const go = () => {
    onFocus(summary.noradId);
    document.getElementById("next-up-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <button type="button" className="next-strip" onClick={go}>
      <span className="next-strip__label">Next:</span>
      <span className="next-strip__text">{summary.text}</span>
      <QualityBadge pass={summary.pass} rating={rating} />
    </button>
  );
}
