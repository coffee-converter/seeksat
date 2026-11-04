import { forwardRef, type ButtonHTMLAttributes } from "react";
import { buttonClass, cx } from "@/lib/ui/classes.mjs";

type Common = {
  /** link: an inline text action (Change, Cancel), underlined in the link colour.
   *  overlay: on top of the map, with an opaque panel backing. */
  variant?: "primary" | "secondary" | "quiet" | "link" | "overlay";
  size?: "md" | "sm";
  tone?: "default" | "danger";
  /** A finished action (Copied, Saved): shows the teal confirmation look. */
  done?: boolean;
  /** Sets aria-pressed, for a toggle. */
  pressed?: boolean;
  /** How "pressed" looks: a filled segment, or an accent outline (a mode that is on, beside a segmented control). */
  pressedLook?: "fill" | "accent";
};
type Plain = Common & { iconOnly?: false };
type IconOnly = Common & { iconOnly: true; "aria-label": string };
export type ButtonProps = (Plain | IconOnly) & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

/** The one button. Icon-only buttons must carry an aria-label (enforced by the type). */
const Button = forwardRef<HTMLButtonElement, ButtonProps & { className?: string }>(function Button(
  { variant, size, tone, done, pressed, pressedLook, iconOnly, className, type = "button", ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={cx(buttonClass({ variant, size, tone, done, iconOnly, pressedLook }), className)}
      {...rest}
    />
  );
});

export default Button;
