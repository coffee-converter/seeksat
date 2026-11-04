"use client";

import { useFlash } from "@/lib/ui/use-flash";

export interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  size?: "md" | "lg";
  /** Makes the whole tile a link (an in-page anchor such as "#passes"). */
  href?: string;
  className?: string;
}

/** One dashboard number: a small label, the value large, a short note. */
export default function StatTile({ label, value, unit, note, size = "md", href, className }: StatTileProps) {
  const flash = useFlash(value);
  const cls = ["stat-tile", size === "lg" ? "stat-tile--lg" : "", className ?? ""].filter(Boolean).join(" ");
  const body = (
    <>
      <span className="stat-tile__label">{label}</span>
      <span className="stat-tile__value num">
        <span className={flash ? `stat-tile__num ${flash}` : "stat-tile__num"}>{value}</span>
        {unit ? <span className="stat-tile__unit">{` ${unit}`}</span> : null}
      </span>
      {note ? <span className="stat-tile__note">{note}</span> : null}
    </>
  );
  return href ? <a className={cls} href={href}>{body}</a> : <div className={cls}>{body}</div>;
}
