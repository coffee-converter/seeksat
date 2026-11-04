import type { ReactNode } from "react";
import { badgeClass } from "@/lib/ui/classes.mjs";

/** A small status pill. The tone is backed by its text; never colour alone. */
export default function Badge({ tone = "neutral", title, children }: {
  tone?: "neutral" | "warn" | "danger" | "ok"; title?: string; children: ReactNode;
}) {
  return <span className={badgeClass(tone)} title={title}>{children}</span>;
}
