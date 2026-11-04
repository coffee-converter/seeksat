"use client";

import { cloneElement, useId, type ReactElement } from "react";
import { cx } from "@/lib/ui/classes.mjs";

interface Props {
  label: string;
  hint?: string;
  error?: string;
  /** Keeps the label for screen readers only, where the placeholder or the row already says what the control is. */
  hideLabel?: boolean;
  /** One input, select or textarea; Field gives it the id and the aria wiring. */
  children: ReactElement<{ id?: string; className?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}

/** A labelled form control with an optional hint and error. */
export default function Field({ label, hint, error, hideLabel = false, children }: Props) {
  const uid = useId();
  const id = children.props.id ?? `${uid}-control`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;
  const described = [children.props["aria-describedby"], hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label className={cx("field__label", hideLabel && "sr-only")} htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        className: cx("field__control", children.props.className),
        "aria-describedby": described || undefined,
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })}
      {hint ? <p id={hintId} className="field__hint">{hint}</p> : null}
      {error ? <p id={errorId} className="field__error" role="alert">{error}</p> : null}
    </div>
  );
}
