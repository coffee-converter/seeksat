"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { cx, surfaceClass } from "@/lib/ui/classes.mjs";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { PASS_VIEW_QUERY, usePassViewStore } from "@/lib/ui/pass-view";

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
  const headRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!open && closing) setClosing(false);
  // Opened by its own button, the card is brought fully into view once it
  // has grown (the least scroll that shows it; its top if it is taller than
  // the view). Not in the phone pass view, where the card is pinned.
  const reveal = useRef(false);
  useEffect(() => {
    if (!open || !reveal.current) return;
    reveal.current = false;
    const dur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-base")) || 0;
    const t = window.setTimeout(() => {
      if (window.matchMedia(PASS_VIEW_QUERY).matches) return;
      const li = headRef.current?.closest("li");
      const smooth = dur > 0;
      li?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
    }, dur + 20);
    return () => window.clearTimeout(t);
  }, [open]);
  const click = (button: HTMLButtonElement) => {
    if (closing) return;
    const ms = open ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-base")) || 0 : 0;
    if (!open) {
      reveal.current = true;
      if (window.matchMedia(PASS_VIEW_QUERY).matches) usePassViewStore.setState({ scrollY: window.scrollY });
    }
    if (ms <= 0) {
      onToggle(button);
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => onToggle(button), ms);
  };
  return (
    <li ref={ref} className={cx("pass-row", open && "pass-row--open", className)} style={{ "--sat-color": color } as CSSProperties}>
      <button ref={headRef} type="button" className="pass-row__btn" aria-expanded={open && !closing} aria-controls={id} onClick={(e) => click(e.currentTarget)}>
        <span className="pass-row__when">
          <span className="pass-row__time">
            {/* Under way: a small live dot, as the header clock's. */}
            {now && <span className="pass-row__now-dot" aria-hidden="true" />}
            {time}
          </span>
          {sub && <span className={cx("pass-row__sub", now && "pass-row__sub--now")}>{sub}</span>}
        </span>
        <span className="pass-row__what">
          <span className="pass-row__name">{name}{tag}</span>
          <span className="pass-row__detail">{detail}</span>
        </span>
        <span className="pass-row__rating">{rating}</span>
      </button>
      {/* The phone pass view's way out (shown there only): the list is hidden. */}
      {open && (
        <Button size="sm" variant="quiet" iconOnly className="pass-row__close" aria-label="Close pass" onClick={() => {
          // The button goes with the card: focus stays on the row.
          const head = headRef.current;
          if (!head) return;
          click(head);
          head.focus({ preventScroll: true });
        }}>
          <Icon name="close" />
        </Button>
      )}
      {open && <div className={cx("pass-row__body", closing && "pass-row__body--closing")}>{children}</div>}
    </li>
  );
}
