// lib/og/og-response.mjs — the request→Response logic for the dynamic
// per-pass OG image route, as a plain module so it is unit-testable
// without importing the @/-aliased Next route. Decodes the ?s= share
// blob, renders the first station's pass chart, returns a PNG; any
// failure falls back to a 302 redirect to the static /og.png so a
// shared link always previews.
import { decodeStateBlob } from "../pass-finder/state-blob.js";
import { renderOgPng } from "./render-og.mjs";

export async function ogResponse(req) {
  const s = new URL(req.url).searchParams.get("s");
  const fallback = () => Response.redirect(new URL("/og.png", req.url), 302);

  const decoded = s ? decodeStateBlob(s) : null;
  if (!decoded || !decoded.observers?.length) return fallback();

  try {
    const png = await renderOgPng(decoded);
    const cache = Number.isFinite(decoded.passTimeMs)
      ? "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800"
      : "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": cache },
    });
  } catch {
    return fallback();
  }
}
