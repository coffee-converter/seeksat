// lib/pass-finder/polar-png.js - rasterize the polar modal SVG to
// a PNG Blob + format an export filename anchored to the pass
// instant in the observer's local timezone.
//
// Both functions are pure: svgToPngBlob takes only the SVG node;
// polarModalFileNameFor takes (obs, ms) so the scene picks which
// moment anchors the filename (typically the active window's start,
// fallback to the playback clock).

// Long-edge target resolution for the exported PNG. 1600px keeps
// file size moderate while still giving a high-DPI screenshot for
// social/blog sharing.
const EXPORT_PX = 1600;

// Rasterize an SVG to a PNG Blob via an offscreen <img> + canvas.
// The SVG must already carry its CSS embedded as a <style> child
// (paintPolarModalStatic does this), so the blob-loaded <img>
// renders standalone. Resolves only AFTER the bitmap fully decodes
// into the <img> + paints to the canvas, so the caller can wait
// before unhiding the modal - otherwise the user sees a frame of
// empty <img> while the PNG paints.
export function svgToPngBlob(svg) {
  return new Promise((resolve, reject) => {
    // XMLSerializer needs xmlns set on the root for the standalone parse.
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      // Match viewBox aspect ratio
      const vb = svg.viewBox.baseVal;
      const aspect = vb.width / vb.height;
      const w = aspect >= 1 ? EXPORT_PX : Math.round(EXPORT_PX * aspect);
      const h = aspect >= 1 ? Math.round(EXPORT_PX / aspect) : EXPORT_PX;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("toBlob failed")), "image/png");
    };
    img.onerror = (e) => { URL.revokeObjectURL(svgUrl); reject(e); };
    img.src = svgUrl;
  });
}

// Output shape:
//   iss-pass-<obs>-YYYY-MM-DDTHHMMSS-OOOO.png
// ISO 8601 extended date + basic-format time + basic UTC offset.
// No colons anywhere (Windows-safe), sortable next to the date.
// Date/time formatted in the observer's tz so the filename
// describes when the pass is for that observer, not when the file
// was saved.
export function polarModalFileNameFor(obs, ms) {
  const obsSlug = (obs?.name ?? "observer").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const tz = obs?.tz;
  const fmtOpts = {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  };
  if (tz) fmtOpts.timeZone = tz;
  // An unrecognized timeZone (e.g. user typed a bogus tz, or a server
  // returned something stale) throws RangeError inside DateTimeFormat.
  // Fall back to runner-local formatting so the filename still resolves
  // - the offsetSlug below also handles the same case and ends up "Z".
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", fmtOpts).formatToParts(new Date(ms));
  } catch (_) {
    delete fmtOpts.timeZone;
    parts = new Intl.DateTimeFormat("en-CA", fmtOpts).formatToParts(new Date(ms));
  }
  const get = (t) => parts.find(p => p.type === t)?.value ?? "";
  const dateSlug = `${get("year")}-${get("month")}-${get("day")}`;
  const timeSlug = `${get("hour")}${get("minute")}${get("second")}`;
  // UTC offset for the tz at that instant. `longOffset` formats it
  // as "GMT-05:00" or "GMT+05:30" - strip prefix and colon for the
  // basic-format tag. Fall back to "Z" when no tz is known.
  let offsetSlug = "Z";
  if (tz) {
    try {
      const op = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, timeZoneName: "longOffset",
      }).formatToParts(new Date(ms));
      const raw = op.find(p => p.type === "timeZoneName")?.value ?? "";
      const tag = raw.replace(/^GMT/, "").replace(":", "");
      if (tag) offsetSlug = tag;
    } catch (_) { /* keep Z */ }
  }
  return `iss-pass-${obsSlug}-${dateSlug}T${timeSlug}${offsetSlug}.png`;
}
