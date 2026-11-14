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
