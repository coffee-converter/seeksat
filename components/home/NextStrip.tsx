import QualityBadge, { type Quality, type RatedPass } from "@/components/passes/QualityBadge";
import type { CloudBadge } from "@/lib/sky/cloud-badge.mjs";

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
export default function NextStrip({ summary, rating, cloud = null, onFocus }: {
  summary: NextSummary | null;
  /** Visual mode: the same rating the pass's card shows. */
  rating?: Quality;
  /** Visual mode: the pass's cloud badge, which carries any cloud reason. */
  cloud?: CloudBadge | null;
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
      <span className="rating-pair">
        <QualityBadge pass={summary.pass} rating={rating} />
        {cloud && <span className={`cloud cloud--${cloud.level}`} title={cloud.title}>{cloud.label}</span>}
      </span>
    </button>
  );
}
