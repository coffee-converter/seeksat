import { HOW_WE_COMPUTE } from "@/lib/sat/numbers.mjs";

// Every line is visible text, never a tooltip.
const ORDER: Array<[keyof typeof HOW_WE_COMPUTE, string]> = [
  ["altitude", "Altitude"],
  ["speed", "Speed"],
  ["groundSpeed", "Ground speed"],
  ["radius", "From Earth's center"],
  ["position", "Latitude and longitude"],
  ["sun", "Sunlight"],
  ["visViva", "Orbit check (vis-viva)"],
  ["elements", "Mean elements"],
  ["epoch", "Epoch"],
];

export default function HowWeCompute() {
  return (
    <section className="sat-how-section" aria-labelledby="sat-how-title">
      <h2 id="sat-how-title" className="home-heading">How we compute these</h2>
      <dl className="sat-how-list">
        {ORDER.map(([key, term]) => (
          <div key={key} className="sat-how-list__row">
            <dt>{term}</dt>
            <dd>{HOW_WE_COMPUTE[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
