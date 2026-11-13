"use client";
// lib/ui/use-units.ts - The units distances and speeds show in: the setting,
// with "auto" resolved from the device's locale. Also keeps the pure modules'
// copy (lib/units.mjs currentUnits, read by the map's labels) in step.
//
// Until the saved settings load, it reads metric, as the server rendered:
// the device's locale (and a saved choice) are only known in the browser,
// and reading them on the first render would differ from the server's HTML.

import { useEffect } from "react";
import { useHomeStore } from "@/lib/home/store";
import { resolveUnits, setCurrentUnits } from "@/lib/units.mjs";

export type Units = "metric" | "imperial";

export function useUnits(): Units {
  const pref = useHomeStore((s) => s.prefs.units);
  const hydrated = useHomeStore((s) => s.hydrated);
  const units = (hydrated ? resolveUnits(pref, navigator.language) : "metric") as Units;
  setCurrentUnits(units);
  useEffect(() => { setCurrentUnits(units); }, [units]);
  return units;
}
