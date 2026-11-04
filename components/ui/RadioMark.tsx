// The radio mark as an inline icon: a dot with two arcs up and to its left, as the map
// draws round dots with known downlinks (lib/map/overlays.mjs radioImage).
// Coloured by currentColor. Decorative unless given a label. The view box is
// cropped to the arcs and dot, so at 1em the dot is about half the line.

export default function RadioMark({ label, className }: { label?: string; className?: string }) {
  return (
    <svg
      className={className ? `radio-mark ${className}` : "radio-mark"}
      viewBox="4 4 16 16"
      width="1em"
      height="1em"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <circle cx="15" cy="15" r="4" fill="currentColor" />
      <path
        d="M8.03 14.39A7 7 0 0 1 14.39 8.03M5.04 14.13A10 10 0 0 1 14.13 5.04"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
