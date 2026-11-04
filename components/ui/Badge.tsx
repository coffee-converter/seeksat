import type { ReactNode } from "react";
import { badgeClass } from "@/lib/ui/classes.mjs";

/** A small status pill. The tone is backed by its text; never colour alone.
 *  "rating" is a borderless pill tinted by the text colour it inherits. */
export default function Badge({ tone = "neutral", title, children }: {
  tone?: "neutral" | "warn" | "danger" | "ok" | "rating"; title?: string; children: ReactNode;
}) {
  return <span className={badgeClass(tone)} title={title}>{children}</span>;
}
