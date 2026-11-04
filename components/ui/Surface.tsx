import type { ReactNode } from "react";
import { cx, surfaceClass } from "@/lib/ui/classes.mjs";

interface Props {
  as?: "div" | "section" | "article";
  /** Inner padding: true (12 px), "sm" (8 / 12 px), or false for a surface
   *  that holds a flush list or grid. */
  padded?: boolean | "sm";
  /** A coloured leading edge, in --surface-accent (set by the context). */
  accent?: boolean;
  /** The selected look: a firmer edge and a 1 px ring. */
  selected?: boolean;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
}

/** The card look: panel colour, hairline edge, rounded corners. For an
 *  element Surface does not render (a list item, a whole-card button), put
 *  surfaceClass() from lib/ui/classes.mjs on it. */
export default function Surface({ as: Tag = "div", padded = true, accent, selected, className, children, ...rest }: Props) {
  return <Tag className={cx(surfaceClass({ padded, accent, selected }), className)} {...rest}>{children}</Tag>;
}
