import QualityBadge from "@/components/passes/QualityBadge";

export interface NextSummary {
  noradId: number;
  name: string;
  text: string;
  pass: { maxElevDeg?: number };
}

/**
 * The soonest pass, above the map on phones, where the Next up list is a
 * long scroll away. Hidden once the panel sits beside the map (1100 px).
 * A tap focuses that satellite and brings its card into view.
 */
export default function NextStrip({ summary, onFocus }: { summary: NextSummary | null; onFocus: (noradId: number) => void }) {
  if (!summary) return null;
  const go = () => {
    onFocus(summary.noradId);
    document.getElementById("next-up-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <button type="button" className="next-strip" onClick={go}>
      <span className="next-strip__label">Next:</span>
      <span className="next-strip__text">{summary.text}</span>
      <QualityBadge pass={summary.pass} />
    </button>
  );
}
