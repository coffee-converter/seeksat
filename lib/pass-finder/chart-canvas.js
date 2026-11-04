// lib/pass-finder/chart-canvas.js - the always-dark charts' canvas colour.
// The sky chart (polar-modal-frame.js) and the radio chart (radio-chart.js)
// paint their ground with it, and --modal-dark-bg is generated from it
// (lib/ui/chart-tokens.mjs), so a chart image sits on its dialog panel
// without a visible edge.
export const CHART_CANVAS = "#0a0e1a";
