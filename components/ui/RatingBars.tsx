const BAR_COUNT = 5;

/** One to five signal bars, coloured red to green (--q1..--q5). `label` is the
 *  accessible name (e.g. "3 of 5"); the bars carry the meaning, colour only backs it up. */
export default function RatingBars({ bars, label }: { bars: 1 | 2 | 3 | 4 | 5; label: string }) {
  return (
    <span className={`qbars qbars--b${bars}`} role="img" aria-label={label}>
      {Array.from({ length: BAR_COUNT }, (_, i) => <i key={i} className={i < bars ? "on" : undefined} />)}
    </span>
  );
}
