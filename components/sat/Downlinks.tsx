import { formatNumber } from "@/lib/sat/numbers.mjs";

export interface Downlink { hz: number; label: string; mode?: string; duty?: string }

export default function Downlinks({ downlinks }: { downlinks: ReadonlyArray<Downlink> }) {
  return (
    <section id="downlinks">
      <h2 className="home-heading">Known downlinks</h2>
      {downlinks.length === 0 ? (
        <p className="home-note">
          No downlink frequencies are on file for this satellite. You can type one into the radio chart.
        </p>
      ) : (
        <ul className="sat-list">
          {downlinks.map((d) => (
            <li key={`${d.hz}-${d.label}`}>
              {`${formatNumber(d.hz / 1e6, 3)} MHz, ${d.label}${d.duty ? ` (${d.duty})` : ""}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
