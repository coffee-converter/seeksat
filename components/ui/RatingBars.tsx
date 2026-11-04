const BAR_COUNT = 5;

/** One to five signal bars, coloured red to green (--q1..--q5). `label` is the
 *  accessible name (e.g. "3 of 5"); the bars carry the meaning, colour only backs it up.
 *  Without a label the bars are decorative (aria-hidden): the caller speaks the
 *  count itself, where it reads best. */
export default function RatingBars({ bars, label }: { bars: 1 | 2 | 3 | 4 | 5; label?: string }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <span className={`qbars qbars--b${bars}`} {...a11y}>
      {Array.from({ length: BAR_COUNT }, (_, i) => <i key={i} className={i < bars ? "on" : undefined} />)}
    </span>
  );
}
