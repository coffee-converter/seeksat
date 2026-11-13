"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
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
  /** Called with the row's button, so the list can keep it in place. */
  onToggle: (button: HTMLButtonElement) => void;
  className?: string;
  ref?: Ref<HTMLLIElement>;
  children: ReactNode;
}) {
  // Closing its own row eases it shut first (--dur-base, 0 with reduced
  // motion), then reports. A row closed because another opened shuts at
  // once, so the tapped row stays where it was (useKeepRowInPlace).
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!open && closing) setClosing(false);
  const click = (button: HTMLButtonElement) => {
    if (closing) return;
    const ms = open ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-base")) || 0 : 0;
    if (ms <= 0) {
      onToggle(button);
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => onToggle(button), ms);
  };
  return (
    <li ref={ref} className={cx("pass-row", open && "pass-row--open", className)} style={{ "--sat-color": color } as CSSProperties}>
      <button type="button" className="pass-row__btn" aria-expanded={open && !closing} aria-controls={id} onClick={(e) => click(e.currentTarget)}>
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
      {open && <div className={cx("pass-row__body", closing && "pass-row__body--closing")}>{children}</div>}
    </li>
  );
}
