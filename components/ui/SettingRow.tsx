"use client";

import { useId, type ReactNode } from "react";

/**
 * One setting: a group label over its control, and an optional hint under it.
 * The row is a labelled group, so a screen reader names the control by the
 * label. Rows stack with a hairline between them (app/ui.css .setting-row).
 */
export default function SettingRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="setting-row" role="group" aria-labelledby={id}>
      <span id={id} className="heading-group">{label}</span>
      <div className="setting-row__control">{children}</div>
      {hint ? <p className="note note--sm">{hint}</p> : null}
    </div>
  );
}
