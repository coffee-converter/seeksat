// lib/og/og-metadata.mjs - metadata helpers for share pages. Kept as a plain
// module so it's unit-testable without importing the @/-aliased page.

import tzlookup from "@photostructure/tz-lookup";
import { sharePath } from "../share/share-link.mjs";

/** "GSAT0201 (GALILEO 5)" -> "GALILEO 5"; other names as they are. */
const commonName = (name) => /^.+? \(([^()]+)\)$/.exec(name ?? "")?.[1] ?? name;

/** A shared place for text: its name, or its coordinates when it has none
 *  or only "My location" (a link shared before GPS places were looked up). */
export function sharedPlace(o) {
  const name = (o?.name ?? "").trim();
  if (name && !/^(my|your) location$/i.test(name)) return name;
  const f = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
  return `${f(o.latDeg, "N", "S")}, ${f(o.lonDeg, "E", "W")}`;
}

/** "Sat 8:28 AM" at the place, in its own time zone. */
function placeTime(ms, latDeg, lonDeg) {
  let timeZone = "UTC";
  try { timeZone = tzlookup(latDeg, lonDeg); } catch { /* the open sea: UTC */ }
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone }).format(ms);
}

/** The title and description of a shared pass: which satellite, from where,
 *  when (at the place), and what the page shows for the mode. */
/** @param {{ satName: string | null, shortName?: string | null, shared: any }} o */
export function sharedPassText({ satName, shortName = null, shared }) {
  const sat = shortName || commonName(satName) || "Satellite";
  const o = shared?.observers?.[0];
  if (!o) return null;
  const place = sharedPlace(o);
  const more = shared.observers.length > 1 ? ` and ${shared.observers.length - 1} more ${shared.observers.length === 2 ? "place" : "places"}` : "";
  const ms = Number.isFinite(shared.passTimeMs) ? shared.passTimeMs : null;
  const when = ms != null ? placeTime(ms, o.latDeg, o.lonDeg) : null;
  const title = when ? `${sat} pass from ${place}${more}, ${when}` : `${sat} passes from ${place}${more}`;
  const what = shared.mode === "radio"
    ? "timing, Doppler shift and where to point an antenna"
    : "when and where to look, how high it climbs and how bright it gets, with a sky chart";
  return { title, description: `${sat} from ${place}${more}${when ? `, ${when}` : ""}: ${what}. Free on SeekSat.` };
}

// Share-page metadata: the satellite page's base metadata with its preview
// images swapped for the per-pass render, and kept out of the index.
/**
 * @param {any} baseMetadata
 * @param {{ noradId: number, blob: string, name?: string | null, shortName?: string | null,
 *   shared?: { observers: { name: string, latDeg: number, lonDeg: number }[], passTimeMs?: number | null, mode?: string } | null }} opts
 */
export function shareMetadata(baseMetadata, { noradId, blob, name = null, shortName = null, shared = null }) {
  const url = `/api/og?s=${encodeURIComponent(blob)}&id=${noradId}`;
  const alt = `${name ? `A ${name}` : 'A satellite'} pass on a globe: its track, the part you can see, and the place it is seen from`;
  // Said as the pass, not the satellite page (link previews show these).
  const text = shared ? sharedPassText({ satName: name, shortName, shared }) : null;
  const words = text ? { title: text.title, description: text.description } : {};
  return {
    ...baseMetadata,
    ...words,
    openGraph: { ...baseMetadata.openGraph, ...words, url: sharePath(noradId, blob), images: [{ url, width: 1200, height: 630, alt }] },
    twitter: { ...baseMetadata.twitter, ...words, images: [{ url, alt }] },
    robots: { index: false, follow: true },
    alternates: { ...baseMetadata.alternates, canonical: `/sat/${noradId}` },
  };
}
