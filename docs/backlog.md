# Backlog

Known follow-ups that are not urgent. Each says what is wrong and what to do.
Take one, fix it with a test, and delete its entry.

## MCP

- **Parallel heavy calls from one caller are refused, not queued.** `lib/mcp/heavy-gate.mjs`
  refuses a second concurrent heavy call from the same caller ("one search at a time per
  caller"), and free callers are keyed by IP, so an agent firing calls in parallel, or two
  people behind one office IP, get a failed tool call. Wait a few seconds for the slot before
  refusing.
- **`find_passes` is outside the heavy gate.** Each row now runs passArc, two light sweeps
  (passLight) and captureProbability, and an empty result re-runs the engine (emptyNote). A
  240-hour radio window on a low orbit is about 60 full rows. Gate it when the window is long
  (or always).
- **Shadow entry in a pass's last partial step can be missed.** `passLight` (lib/mcp/passes.mjs)
  uses findWindowsFromPredicate, which never samples between the last grid step and `toMs`, so a
  shadow entry in that tail leaves `entersShadow` null and `visibleUntil` up to a step (60 s)
  late. Sample `toMs` itself.

## Tidy-ups (no behaviour change)

- **The radio and visual scans duplicate about 150 lines.** `radioScanTool` and `visualScanTool`
  (lib/mcp/tools.mjs) copy the window, limit, stage cache, refine, row building and chart code,
  and also bestPassTool's row building. One helper taking (stage function, rough comparator,
  row extras) would cover all three.
- **Two copies of the time-zone offset code.** `wallClock` in lib/mcp/local-time.mjs re-implements
  `offsetMinutes` from lib/time/zone.mjs (one rounds to the minute, the other to the second).
  Export a second-resolution helper from zone.mjs and use it in both.
- **The dark-sky threshold is defined twice.** `DARK_SUN_ALT_DEG = -6` in lib/mcp/visual-scan.mjs
  duplicates the one lib/mcp/sky.mjs exports. Import it.
- **`staleDuring(epoch, t, t)` is just `staleAt(epoch, t)`.** Three calls in lib/mcp/tools.mjs
  (the scans and the multi-satellite best_pass loop) pass the same time twice. Call `staleAt`.

## Site follow-ups from the SatNOGS reception work

- **Radio pass cards:** show the reception line ("heard 24 times in the last 2 days", "SatNOGS stations
  tried 5 times and heard nothing") from `lib/reception/` on the site's radio pass cards and live view.
  The MCP rows already carry it; the site needs the tally served (a small `/api/reception` or folded into
  `/api/sats`).
- **Range in the site's bars:** the MCP radio rating takes a bar off per 6 dB of path loss beyond 2,000 km
  (`lib/passes/quality.mjs radioQuality`); the site's bars are still height only, so a far MEO pass reads
  higher on the site than in MCP answers. Engine passes need the peak range to use it.

## Reception collector: back to every 4 hours after the backfill

`vercel.json` runs `/api/refresh-reception` at :11, :31 and :51 in every hour the catalog refresh does
not use, so the first 7 days fill in within hours (about 65 pages a run, 3 runs an hour, under the
token's 240 an hour). Once the logs show runs with nothing left to sweep ("0 windows", expected
2026-11-14 evening UTC), set it back to `41 2-22/4 * * *` and drop the note in CLAUDE.md.
