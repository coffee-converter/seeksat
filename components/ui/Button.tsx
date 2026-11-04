import { forwardRef, type ButtonHTMLAttributes } from "react";
import { buttonClass, cx } from "@/lib/ui/classes.mjs";

type Common = {
  /** link: an inline text action (Change, Cancel), underlined in the link colour. */
  variant?: "primary" | "secondary" | "quiet" | "link";
  size?: "md" | "sm";
  tone?: "default" | "danger";
  /** A finished action (Copied, Saved): shows the teal confirmation look. */
  done?: boolean;
  /** Sets aria-pressed, for a toggle. */
  pressed?: boolean;
};
type Plain = Common & { iconOnly?: false };
type IconOnly = Common & { iconOnly: true; "aria-label": string };
export type ButtonProps = (Plain | IconOnly) & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

/** The one button. Icon-only buttons must carry an aria-label (enforced by the type). */
const Button = forwardRef<HTMLButtonElement, ButtonProps & { className?: string }>(function Button(
  { variant, size, tone, done, pressed, iconOnly, className, type = "button", ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={cx(buttonClass({ variant, size, tone, done, iconOnly }), className)}
      {...rest}
    />
  );
});

export default Button;
