import type { ReactNode } from "react";
import { cx } from "@/lib/ui/classes.mjs";

interface Props {
  as?: "div" | "section" | "article";
  /** Inner padding; off for a surface that holds a flush list or grid. */
  padded?: boolean;
  className?: string;
  children: ReactNode;
}

/** The card look: panel colour, hairline edge, rounded corners. */
export default function Surface({ as: Tag = "div", padded = true, className, children }: Props) {
  return <Tag className={cx("surface", padded && "surface--padded", className)}>{children}</Tag>;
}
