# Radio ranking by recent reception (SatNOGS)

## Why

The radio rating is elevation alone, so dead satellites rate "Excellent", 20 passes can all read
89° Excellent with nothing to choose between them, and a satellite 8,000 km up rates the same as a
400 km cubesat. Raised by the owner's MCP agent after a day of real use with SpyServer receivers
and SatNOGS lookups; its points are folded in below. Its headline cases: the ISS's most-heard
SatNOGS downlink was 437.550 SSTV (24 good observations in 48 h) while SeekSat did not list it
(since added by hand); RS-44 had no observations at all and is very much alive.

## What we know (checked 2026-11-14)

- Our downlinks come from SatNOGS DB transmitters, already filtered to `status: active`,
  `alive: true`, not unconfirmed (lib/mirror/satnogs.mjs), refreshed once a day by the catalog
  refresh. Curated satellites use a hand-checked list instead (lib/catalog.mjs), which overrides
  SatNOGS.
- SatNOGS DB's satellite `reception_status` is "Unknown" for 2,843 of 2,851 satellites, and its
  `status` is only in orbit / re-entered / future. Neither tells alive from dead.
- The real signal is SatNOGS Network observations. From the agent's use: `status=good&start=&end=`
  works; `vetted_status` returned future scheduled observations (do not use); results come 25 a
  page; one paginated sweep of a day's observations is cheaper than ~1,000 per-satellite queries.

## Design

1. **Per transmitter, not per satellite.** Each downlink keeps its SatNOGS `transmitter_uuid`
   (and `downlink_low`). Curated downlinks are matched to SatNOGS transmitters by frequency
   (within a few kHz). Observations are grouped by transmitter.
2. **Counts.** Per downlink: `heardLast48h`, `heardLast7d`, `heardLast30d`, `lastHeard`, and the
   same for failed observations (`status=bad`). Episodic activity (SSTV events lasting days,
   FO-29 only when sunlit) must read right: "24 times in 2 days" vs "once 3 weeks ago".
3. **Three states, never capping unknown.** Good observations recently: heard. Only bad ones:
   probably silent (flag it, and cap its rating). None at all: unknown (rated as now, not capped).
4. **Collection.** A daily job (production only, like the refresh; part of it or beside it)
   sweeps the previous day's good and bad observations in one paginated pass, with an
   identifying User-Agent, backoff on 429/5xx, and a page cap. It keeps a rolling 30-day tally
   per transmitter in the snapshot store (daily buckets). First run backfills 7 days, not 30.
   Attribution: SatNOGS data is CC BY-SA 4.0 (already credited for transmitters).
5. **Use.**
   - A satellite's downlinks are listed most recently heard first.
   - `get_radio_pass` defaults to the most recently heard downlink unless a frequency is given.
   - Radio scans (best_pass radio, whats_up_now radio): reception breaks ties within a rating;
     "probably silent" is flagged and capped.
   - MCP rows carry the counts and `lastHeard`; the site's radio pass card can show "heard 24×
     in the last 2 days" (follow-up).
6. **Range in the radio rating.** Slant range at the best point of the pass affects the rating:
   free-space path loss, 8,000 km is about 26 dB worse than 400 km. Needs no new data.
7. **Amateur bands first.** With no `bands` filter, radio scans rank amateur VHF/UHF downlinks
   ahead of S-band (2.2 GHz) telemetry most hobby receivers cannot tune; S-band still appears
   when asked for. Needs no new data.

## Phases

1. Range in the rating (6) and amateur bands first (7). Small, no new data.
2. The reception collector (4) and the per-transmitter tally (1, 2), with tests on recorded
   SatNOGS pages; no behaviour change yet.
3. Use it (3, 5): ordering, defaults, flags, caps, MCP fields. Then the site's card line.

## Open questions

- How far back the first backfill goes, and the daily page cap, once we see a day's volume.
- Whether "probably silent" also needs a minimum number of bad observations before it caps.
