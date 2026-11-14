"use client";

import Button from "@/components/ui/Button";
import { Details } from "@/components/ui/Disclosure";
import { useHomeStore } from "@/lib/home/store";
import { BANDS, BAND_IDS, parseBands } from "@/lib/radio/bands.mjs";

const bandList = BANDS as ReadonlyArray<{ id: string; label: string }>;
const bandsFrom = parseBands as (v: unknown) => string[] | null;

/** Radio mode: the bands this radio covers, saved on the device. Frequencies
 *  outside them do not count: no radio mark, no default to tune to. */
export default function BandPicker({ ready }: { ready: boolean }) {
  const bands = useHomeStore((s) => s.prefs.bands);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const on = (id: string) => bands == null || bands.includes(id);
  const toggle = (id: string) => {
    const now = bands ?? [...(BAND_IDS as readonly string[])];
    const next = now.includes(id) ? now.filter((b) => b !== id) : [...now, id];
    setPrefs({ bands: bandsFrom(next) });
  };
  // Name the shorter list: what is on, or (when most are) what is off.
  const labels = (ids: string[]) => bandList.filter((b) => ids.includes(b.id)).map((b) => b.label).join(", ");
  const off = bands == null ? [] : (BAND_IDS as readonly string[]).filter((id) => !bands.includes(id));
  const summary = bands == null ? "all bands"
    : bands.length === 0 ? "no bands"
      : off.length < bands.length ? `all but ${labels(off)}` : labels(bands);
  return (
    <Details className="home-controls__bands" summary={<span>{`Your radio hears ${ready ? summary : "…"}`}</span>}>
      <div className="home-controls__band-row" role="group" aria-label="Bands your radio covers">
        {bandList.map((b) => (
          <Button key={b.id} size="sm" pressed={on(b.id)} disabled={!ready} onClick={() => toggle(b.id)}>
            {b.label}
          </Button>
        ))}
      </div>
    </Details>
  );
}
