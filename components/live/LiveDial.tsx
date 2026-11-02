/**
 * A compass seen from above: N up, E right, as when holding a phone flat.
 * Rings mark 0, 30 and 60 degrees of elevation; the centre is straight up.
 * With a phone heading, the dial turns so its top is where the phone points.
 */
const R = 100;

function point(azDeg: number, elDeg: number, rotDeg: number): [number, number] {
  const r = (R * (90 - Math.max(0, Math.min(90, elDeg)))) / 90;
  const a = ((azDeg - rotDeg) * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

interface Props {
  track: Array<{ azDeg: number; elDeg: number }>;
  now: { azDeg: number; elDeg: number } | null;
  headingDeg: number | null;
}

export default function LiveDial({ track, now, headingDeg }: Props) {
  const rot = headingDeg ?? 0;
  const line = track
    .filter((s) => s.elDeg >= 0)
    .map((s) => point(s.azDeg, s.elDeg, rot).map((v) => v.toFixed(1)).join(","))
    .join(" ");
  const p = now ? point(now.azDeg, now.elDeg, rot) : null;
  const card = (label: string, az: number) => {
    // Just outside the horizon ring.
    const a = ((az - rot) * Math.PI) / 180;
    const [x, y] = [(R + 12) * Math.sin(a), -(R + 12) * Math.cos(a)];
    return <text key={label} x={x} y={y + 4} textAnchor="middle" className="live-dial__card">{label}</text>;
  };
  return (
    <figure className="live-dial">
      <svg viewBox="-122 -122 244 244" role="img" aria-label={now
        ? `Satellite at azimuth ${Math.round(now.azDeg)} degrees, ${Math.round(now.elDeg)} degrees up`
        : "This pass is over"}>
        <circle r={R} className="live-dial__horizon" />
        <circle r={(R * 60) / 90} className="live-dial__ring" />
        <circle r={(R * 30) / 90} className="live-dial__ring" />
        {headingDeg != null && <line x1={0} y1={0} x2={0} y2={-R} className="live-dial__ahead" />}
        {card("N", 0)}{card("E", 90)}{card("S", 180)}{card("W", 270)}
        {line && <polyline points={line} className="live-dial__track" />}
        {p && <line x1={0} y1={0} x2={p[0]} y2={p[1]} className="live-dial__arrow" />}
        {p && <circle cx={p[0]} cy={p[1]} r={6} className="live-dial__sat" />}
      </svg>
      <figcaption className="live-dial__caption">
        {headingDeg != null ? "Compass view, turned to where your phone points" : "Compass view, north up"}
      </figcaption>
    </figure>
  );
}
