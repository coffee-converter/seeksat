import { clockFormat } from "@/lib/clock.mjs";

/** The site's pass clock, with no-break spaces so "6:27 PM" never wraps apart. */
export const passTime = (ms: number, timeZone?: string) =>
  (clockFormat as (l: undefined, tz?: string) => Intl.DateTimeFormat)(undefined, timeZone).format(ms).replace(/\s/g, "\u00a0");
