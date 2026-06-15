// lib/mcp/pass-chart.mjs — render the next pass's polar sky chart to a PNG
// for the get_pass_chart MCP tool. Reuses the OG-image render pipeline
// (renderPassChartSVG + resvg). Importing render-pass-chart installs the
// linkedom DOM the painters need.
import { nextPassWindow } from './passes.mjs';
import { makeEcefSampler } from './ecef-sampler.mjs';
import { renderPassChartSVG } from '../og/render-pass-chart.mjs';
import { rasterizeSvg } from '../og/rasterize.mjs';
import { issAltAzDeg } from '../pass-finder/visibility.js';
import { peakMagnitudeInWindow } from '../pass-finder/scoring.js';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compassOf = (azDeg) => COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];

// observer: { name?, latDeg, lonDeg }. Returns { pngBase64, summary } when
// a pass exists, else { summary } (text-only).
export async function renderPassChartPng({ entry, record, observer, mode = 'visual', nowMs, scanHours = 72 }) {
  const loc = observer.name || `${observer.latDeg.toFixed(2)}, ${observer.lonDeg.toFixed(2)}`;
  const pass = nextPassWindow({
    line1: record.line1, line2: record.line2, observer,
    startMs: nowMs, windowHours: scanHours, mode,
  });
  if (!pass) {
    return { summary: `No upcoming ${mode} pass for ${entry.name} from ${loc} in the next ${scanHours}h.` };
  }
  const sampler = makeEcefSampler(record.line1, record.line2);
  // full layout: the complete modal (title, legend, sky background) — a
  // self-contained chart for the agent, not the cropped social-card circle.
  const svg = renderPassChartSVG({
    observer, win: pass.win, peakMs: pass.peakMs, issEcefAt: sampler, satName: entry.name, full: true,
  });
  // renderPassChartSVG uses linkedom's toString() which omits xmlns; resvg
  // requires it to parse the document root. Inject it before rasterizing.
  const svgWithNs = svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  const png = await rasterizeSvg(svgWithNs, { width: 800 });

  const peakEcef = sampler(new Date(pass.peakMs));
  const peak = peakEcef ? issAltAzDeg(observer, peakEcef) : { alt: null, az: null };
  const mag = peakMagnitudeInWindow(pass.win, [observer], sampler, entry.standardMag);
  const summary =
    `${entry.name} over ${loc}: rises ${new Date(pass.win.startMs).toISOString()}, ` +
    `peaks ${peak.alt == null ? '?' : peak.alt.toFixed(0)}° to the ${peak.az == null ? '?' : compassOf(peak.az)}` +
    `${mag == null ? '' : `, ~mag ${mag.toFixed(1)}`}. The chart shows where to look.`;
  return { pngBase64: png.toString('base64'), summary };
}
