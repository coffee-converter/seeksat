"use client";

import { useRef } from "react";
import { cx, segmentedNext } from "@/lib/ui/classes.mjs";

type Option<T extends string> = { value: T; label: string; disabled?: boolean };

/** A single-choice control as a radiogroup: one tab stop (roving tabindex),
 *  arrow keys / Home / End move and select, wrapping. */
export default function Segmented<T extends string>({ label, description, options, value, onChange, size = "md" }: {
  label: string; /** Extra spoken help (aria-description). */ description?: string; options: Option<T>[]; /** null: nothing chosen yet (e.g. before saved settings load). */ value: T | null; onChange: (v: T) => void; size?: "md" | "sm";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled).map((o) => o.value);
  // The tab stop: the selected option, or the first enabled one when it is disabled or missing.
  const stop = value !== null && enabled.includes(value) ? value : enabled[0];

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Alt/Meta/Ctrl + arrow is a browser or OS shortcut (back, word jump): leave it alone.
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const to = segmentedNext(enabled, value, e.key, e) as T;
    if (to === value && !(e.key === "Home" || e.key === "End")) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    if (to !== value) onChange(to);
    ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(to)}"]`)?.focus();
  };

  return (
    <div className={cx("segmented", size === "sm" && "segmented--sm")} role="radiogroup" aria-label={label} aria-description={description} ref={ref} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={value === o.value}
          tabIndex={o.value === stop ? 0 : -1}
          disabled={o.disabled}
          className="segmented__opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
