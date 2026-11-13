"use client";
// lib/ui/use-units.ts - The units distances and speeds show in: the setting,
// with "auto" resolved from the device's locale. Also keeps the pure modules'
// copy (lib/units.mjs currentUnits, read by the map's labels) in step.

import { useEffect } from "react";
import { useHomeStore } from "@/lib/home/store";
import { resolveUnits, setCurrentUnits } from "@/lib/units.mjs";

export type Units = "metric" | "imperial";

export function useUnits(): Units {
  const pref = useHomeStore((s) => s.prefs.units);
  const units = resolveUnits(pref, typeof navigator === "undefined" ? undefined : navigator.language) as Units;
  setCurrentUnits(units);
  useEffect(() => { setCurrentUnits(units); }, [units]);
  return units;
}
