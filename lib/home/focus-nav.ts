import { focusDestination } from "@/lib/home/focus.mjs";
import { useHomeStore } from "@/lib/home/store";

/** The page a focus opens, or null for a pasted satellite (it stays on home). */
export function focusDestinationFor(id: number): string | null {
  return focusDestination(id, useHomeStore.getState().prefs.custom.map((c) => c.noradId)) as string | null;
}
