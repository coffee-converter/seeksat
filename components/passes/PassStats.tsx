import { clockFormat } from "@/lib/clock.mjs";
import { sameClock } from "@/lib/time/zone.mjs";
import { viewerZone } from "@/components/usePlaceZone";

/** The site's pass clock, with no-break spaces so "6:27 PM" never wraps apart. */
export const passTime = (ms: number, timeZone?: string) =>
  (clockFormat as (l: undefined, tz?: string) => Intl.DateTimeFormat)(undefined, timeZone).format(ms).replace(/\s/g, "\u00a0");

/** The zone's short name at ms ("CST", "GMT-3"), or "". */
export function zoneAbbr(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** Whether the place's clock reads differently from the viewer's at ms. */
export function otherClock(ms: number, timeZone?: string): boolean {
  if (!timeZone || typeof window === "undefined") return false;
  try {
    return !(sameClock as (a: string, b: string, at: number) => boolean)(timeZone, viewerZone(), ms);
  } catch {
    return false;
  }
}

/** passTime, with the zone after it ("5:41 PM GMT-3") when the place's clock
 *  differs from the viewer's, so a time elsewhere is never read as local. */
export const passTimeZoned = (ms: number, timeZone?: string) =>
  otherClock(ms, timeZone) ? `${passTime(ms, timeZone)}\u00a0${zoneAbbr(ms, timeZone!)}` : passTime(ms, timeZone);
