"use client";

import type { CSSProperties, ReactNode, Ref } from "react";
import { cx, surfaceClass } from "@/lib/ui/classes.mjs";

/** The list a day's rows sit in: a Surface holding them flush. */
export const passRowsClass = cx("pass-list__rows", surfaceClass({ padded: false }));

/** One pass as a compact row (when, what, how good) that opens in place.
 *  The home list and the satellite page share it. */
export default function PassRow({ id, color, time, sub, now = false, name, tag, detail, rating, open, onToggle, className, ref, children }: {
  id: string;
  color: string;
  time: string;
  sub?: string;
  now?: boolean;
  name: string;
  tag?: ReactNode;
  detail: string;
  rating?: ReactNode;
  open: boolean;
  onToggle: () => void;
  className?: string;
  ref?: Ref<HTMLLIElement>;
  children: ReactNode;
}) {
  return (
    <li ref={ref} className={cx("pass-row", className)} style={{ "--sat-color": color } as CSSProperties}>
      <button type="button" className="pass-row__btn" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className="pass-row__when">
          <span className="pass-row__time">{time}</span>
          {sub && <span className={cx("pass-row__sub", now && "pass-row__sub--now")}>{sub}</span>}
        </span>
        <span className="pass-row__what">
          <span className="pass-row__name">{name}{tag}</span>
          <span className="pass-row__detail">{detail}</span>
        </span>
        <span className="pass-row__rating">{rating}</span>
      </button>
      {open && children}
    </li>
  );
}
