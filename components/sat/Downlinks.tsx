import { formatNumber } from "@/lib/sat/numbers.mjs";
import { linkClass } from "@/lib/ui/classes.mjs";
import { SATNOGS_URL } from "@/lib/mirror/satnogs.mjs";
import { uplinkText } from "@/lib/radio/uplink.mjs";

export interface Downlink {
  hz: number; label: string; mode?: string | null; duty?: string; source?: string;
  uplink?: { hz: number; highHz?: number; mode?: string; tone?: number; invert?: boolean } | null;
}
const upText = uplinkText as (u: Downlink["uplink"]) => string | null;

/** ", FM" after the label, unless the label already names the mode as a word
 *  ("passband" must not count as SSB). */
function modeNote(d: Downlink): string {
  if (!d.mode) return "";
  const word = new RegExp(`(^|[^a-z0-9])${d.mode.replace(/[^a-z0-9]/gi, "\\$&")}([^a-z0-9]|$)`, "i");
  return word.test(d.label) ? "" : `, ${d.mode.toUpperCase()}`;
}

export default function Downlinks({ downlinks }: { downlinks: ReadonlyArray<Downlink> }) {
  return (
    <section id="downlinks">
      <h2 className="heading-section">Known downlinks</h2>
      {downlinks.length === 0 ? (
        <p className="note">
          No downlink frequencies are on file for this satellite. You can type one into the radio chart.
        </p>
      ) : (
        <ul className="sat-list">
          {downlinks.map((d) => (
            <li key={`${d.hz}-${d.label}-${d.mode ?? ""}`}>
              {`${formatNumber(d.hz / 1e6, 3)} MHz, ${d.label}${modeNote(d)}${d.duty ? ` (${d.duty})` : ""}`}
              {d.uplink && <><br /><span className="sat-list__sub">{upText(d.uplink)}</span></>}
            </li>
          ))}
        </ul>
      )}
      {downlinks.some((d) => d.source === "satnogs") && (
        <p className="note">
          From{" "}
          <a className={linkClass()} href={SATNOGS_URL} target="_blank" rel="noreferrer">SatNOGS DB</a>
          {" "}(CC BY-SA 4.0), contributed by listeners and not checked by SeekSat. Some may be off the air.
        </p>
      )}
    </section>
  );
}
