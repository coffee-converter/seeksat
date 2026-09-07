# Radio mode: Doppler, angular rate, and signal prediction

Design spec — 2026-09-06

## 1. Motivation

Radio mode today is a visibility predicate with no light gates plus a
two-factor score. It tells you *when* a satellite is reachable and says
nothing about *what you will hear*.

This adds a per-observer prediction chart for a radio pass: the Doppler
curve, the angular rate, and the received-signal envelope on a shared
time axis, plus a CSV export for driving a rig or a camera.

The originating request (from a ham planning to capture an FM downlink
carrier while filming the same pass) is to make the joint radio+optical
observation legible: the range rate swings through zero at closest
approach while the angular motion peaks there, and the two together
pin the geometry far more tightly than either alone.

## 2. Scope

**In:**

- A pure sampler producing the full per-pass time series.
- A fullscreen per-observer chart with three stacked panels.
- Per-satellite downlink frequencies in the catalog.
- CSV export of the series.
- Observer elevation, looked up from lat/lon.
- Share-link support for the selected frequency.

**Out (deliberately):**

- Importing an observed SDR recording. This is the piece that would
  turn the chart from a prediction into evidence, and it is the
  natural next project. Every interface here is shaped to accept it.
- Absolute link budgets (EIRP, antenna gain, noise figure).
- Terrain masking.
- A radio-specific refraction model.
- New satellites in the catalog (see §10, Tier 3).

## 3. Architecture

Four units, following the existing separation of pure math in
`lib/pass-finder/` from imperative scene code:

*Updated 2026-09-06 to match what was built.* The original four units below
became nine as testability forced splits; each is noted with why.

| unit | file | responsibility |
|---|---|---|
| state sampler | `lib/pass-finder/sat-state.js` | pure; SGP4 position **and velocity**, TEME + ECEF. Split out so the frame discipline in §5.1 has one home and one test. |
| Doppler | `lib/pass-finder/doppler.js` | pure; light-time retardation + the exact frequency ratio |
| optics | `lib/pass-finder/radio-optics.js` | pure; apparent angular rate, refraction direction, signal envelope |
| window rule | `lib/pass-finder/radio-window.js` | pure; which slice of time to chart (§15.1). Split out because the rule was untestable while it lived in the scene. |
| sampler | `lib/pass-finder/radio-pass.js` | pure; window + observer + frequency → time series + summary |
| painter | `lib/pass-finder/radio-chart.js` | pure; series → SVG with embedded CSS |
| export | `lib/pass-finder/radio-csv.js` | pure; series → CSV text |
| shared | `lib/pass-finder/radio-format.js`, `text.js` | the transmit-oscillator assumption, and generic string helpers |
| modal | `components/passes/RadioModal.tsx` | open/close lifecycle, copy/save, mirrors `PolarModal.tsx` |

The sampler is the single source of physics. The painter, the CSV, the
chart header readouts, and any future MCP tool all consume its output.
Nothing downstream recomputes.

## 4. The sampler

```
radioPassSamples(obs, window, deps, { freqHz, stepMs = 2000 })
  -> { samples: [...], summary: {...} }
```

`deps` is `{ satStateAt, obsEcef, upEcef }`. `satStateAt(jsDate)` returns
`{ rTeme, vTeme, rEcef, gmst }` in metres and m/s — `gmst` is needed to put
the observer into TEME for the Doppler calculation (§5.1).
See §5.1 — this replaces the current `issEcefAt`, which discards
velocity.

### 4.1 Window selection

Chart the **observer's own full pass**, not the joint multi-observer
window. Window-list rows are intersections across all observers;
charting an intersection would truncate the S-curve and report a Δf
that is not that observer's actual maximum.

`passWindowAtMsForObserver` in `observer-pass.js` already computes the
per-observer window. Anchor it at the joint window's peak. Shade the
joint interval inside the chart when more than one observer exists.
For a single observer the two coincide.

### 4.2 Per-sample fields

| field | definition |
|---|---|
| `tMs` | integer milliseconds (see §16.7) |
| `rangeM` | \|r_sat − r_obs\| |
| `rangeRateMps` | §5.2, analytic |
| `dopplerHz` | §5.3, exact ratio, light-time corrected |
| `elDeg`, `azDeg` | via existing `issAltAzDeg`; **apparent** (refracted) |
| `angRateDegPerSec` | §6 |
| `dopplerRateHzPerSec` | §9.3, central difference. Lives on the sample so the CSV and the summary read one value rather than each recomputing it (§3). |
| `relSignalDb` | §7 |

## 5. Doppler

### 5.1 Frame — work in TEME, never convert velocity

**This is the single most dangerous part of the implementation.**

`sat.propagate()` returns position *and* velocity in TEME (km, km/s;
verified in satellite.js 6.0.2). `sat.eciToEcf()` is a pure Z-rotation
(`dist/satellite.js:2942`). Applying it to a velocity vector is wrong:
the correct transform is `R(θ)·v_TEME − ω × r_ECEF`, and the omitted
term is 495 m/s.

Measured against the real library with a real ISS TLE and a Chicago
observer: **314 m/s of range-rate error, 459 Hz at 437.800 MHz.** The
resulting curve is still a clean S-shape crossing zero at the right
time. Nothing about it looks broken.

Avoid it structurally rather than by remembering a correction:

- **Doppler in TEME.** Take `r_sat`, `v_sat` straight from SGP4 with no
  conversion at all. Rotate the observer's ECEF position into TEME and
  give it the velocity of a point fixed to the rotating Earth:

  ```
  θ = gstime(date)
  r_obs_teme = [ x·cosθ − y·sinθ,  x·sinθ + y·cosθ,  z ]     // inverse of eciToEcf
  v_obs_teme = ω × r_obs_teme  =  [ −ω·y_teme, ω·x_teme, 0 ]
  ```

- **Elevation, azimuth, and the visibility predicate stay in ECEF**,
  using the existing `issAltAzDeg` and `eciToEcf(position, …)`.

- **Range is frame-invariant.** Compute it wherever is convenient.

No velocity is ever rotated, so the trap cannot occur.

`ω` must be the **sidereal** rotation rate, `7.292115855e-5 rad/s`,
consistent with what `gstime` implies. Using `2π/86400` (the solar day)
is a 0.27% error → 1.35 m/s → **2.0 Hz**.

### 5.2 Range rate — analytic, never finite differences

```
ṙ = ( (r_sat − r_obs) · (v_sat − v_obs) ) / |r_sat − r_obs|
```

Central-differencing the range instead has a hard noise floor.
Measured against the real library:

| h | analytic vs central difference |
|---|---|
| 1000 ms | 177 mm/s (258 mHz) — best |
| 500 ms | 224 mm/s (327 mHz) |
| 100 ms | 940 mm/s |
| 10 ms | 11 882 mm/s |
| 1 ms | 89 706 mm/s (**131 Hz**) |

Error grows as `1/h`: roundoff, not truncation. Root cause is in
`propagate()`:

```js
var m = (j - satrec.jdsatepoch) * minutesPerDay;   // dist/satellite.js:2819
```

Both Julian dates are ≈2.46×10⁶ and each carries ~47 µs of double
representation error (v6.0.2 has no split `jdsatepochF`), giving ~0.36 m
of along-track position noise. That matches the observed ~0.2 m floor.

The analytic form is immune: time noise perturbs SGP4's velocity by
`r̈ × 47 µs` ≈ 0.006 m/s and the unit vector by 4×10⁻⁷ rad — about
0.003 m/s total, roughly **100× better** than the best finite difference.

*Optional refinement:* calling `sgp4(satrec, minutesSinceEpoch)` with
minutes computed from integer milliseconds sidesteps the cancellation
and removes the floor. Not required; it tightens TCA interpolation from
~0.8 ms to ~0.25 ms.

### 5.3 The Doppler formula — exact ratio, light-time corrected

Light travel time first, by fixed-point iteration (2–3 passes; seed each
sample from the previous sample's τ):

```
τ = |r_sat(t − τ) − r_obs(t)| / c
```

Then, with `n̂` the unit vector along the photon path (from the
satellite at emission toward the observer at reception), `v_tx` the
satellite velocity at `t − τ`, and `v_rx` the observer velocity at `t`,
all in TEME:

```
f_rx / f_tx = (1 − n̂·v_rx/c) / (1 − n̂·v_tx/c)
              × (γ_rx / γ_tx)
              × (1 + (Φ_tx − Φ_rx)/c²)

dopplerHz = f_rx − f_tx
```

Sign conventions, because both factors are easy to invert: the proper-time
ratio is `dτ_tx/dτ_rx = γ_rx/γ_tx`, so a fast-moving transmitter clock runs
slow and is seen redshifted. `Φ = −GM/r` (negative), so a satellite higher in
the well has the larger `Φ` and is seen blueshifted. For LEO the velocity term
dominates and the net is a redshift.

Use the **exact ratio**, not `−f·ṙ/c`. The linear approximation carries
0.242 Hz of its own error — larger than the light-time term it would be
sitting beside. Total avoidable error from the naive formulation is
**0.419 Hz**, comparable to the ionosphere and inside the TLE band.

Sign convention, verified end to end against the real library:
**approaching gives a higher received frequency.**

### 5.4 What to model and what to budget

The criterion is not magnitude, it is **variation across the pass.**
The transmitter's oscillator offset is unknown and constant at ±1.1 kHz,
so any term that is constant over a pass is perfectly degenerate with it
and cannot be measured.

Measured across one pass:

| term | variation | verdict |
|---|---|---|
| relativistic (γ + Φ) | 0.0074 **mHz** | constant — unobservable |
| light-time | 0.2576 Hz | observable |

Include everything computable anyway — it is free and consistent. Reserve
the error budget (§14) for genuine uncertainties, not for terms we chose
to skip.

The observed Doppler null therefore lags geometric closest approach by
exactly one light travel time, ≈1.4 ms.

## 6. Angular rate

Compute from **unit line-of-sight vectors**, never from alt/az
components:

```
ω = atan2( |û₁ × û₂|, û₁·û₂ ) / Δt
```

Azimuth is singular at the zenith. Measured on a zenith pass, the alt/az
decomposition returns **0.0000 °/s where the true value is 1.0244 °/s** —
a total failure at the single most important point of the most
interesting pass. It also reads ~0.24% low elsewhere. `atan2` of
cross-over-dot is stable at all angles; `arccos` loses precision near 1.

Use **apparent (refracted)** unit vectors, because this curve is what a
camera measures. Refraction reduces ω by 7.97% at 1.5° elevation, 0.85%
at 9.9°, 0.14% at 26.9°.

To build an apparent direction, rotate the true direction **upward** by
`apparentAltDeg(el) − el` (Saemundsson) in the vertical plane. Note that
`correctRefraction()` in `lib/refraction.js` performs the **inverse**
(apparent → true, rotating toward the horizon). Using it as written
applies refraction backwards — roughly 1° of error at 1.5° elevation.

`issAltAzDeg` itself is correct and returns finite values at zenith;
only its *derivative* is unusable there.

## 7. Signal

```
relSignalDb = −20·log10( rangeM / rangeMinM )
```

Free-space path loss only, relative to the pass peak. At 137–438 MHz
atmospheric absorption is under 0.1 dB even near the horizon; adding an
"atmospheric term" would be decoration. What actually degrades low passes
— antenna pattern, terrain, multipath — is site-specific and not
modelled.

Annotate the peak with the absolute FSPL (`20·log10(4πrf/c)`; 137.7 dB
at 420 km on 437.800) so the relative axis has a checkable anchor.

**Polarization caveat, required on the chart.** Faraday rotation
`Ω = 2.36×10⁴·B∥·TEC/f²` gives 28° at 437.800 but 254° at 145.800 and
288° (0.8 full turns) at 137.100. With a linearly polarized antenna that
means deep nulls at VHF that have nothing to do with range. This curve is
an envelope valid for circular polarization.

## 8. Derived quantities

All computed directly from SGP4 — no model fitting. An earlier draft
fitted a straight-line model to extract speed and range; it was dropped
once we settled on using the real WGS84 geometry, because the propagator
gives these exactly and the fit carried a systematic `√(R_local/r_sat)`
bias of about 3.5%.

Report in the chart header:

- **Closest approach range** and its time, from a parabolic
  interpolation of the range minimum (§9.2).
- **Peak-to-peak Doppler**, taking both edges independently — passes are
  **not** symmetric (measured up to −4.88% on a grazing pass, 0.02% on a
  46.8° pass).
- **Maximum Doppler rate**, at TCA.
- **Maximum angular rate**.
- **Doppler at reference elevations** (10°, 30°, TCA). These are
  measurable from a partial capture; peak-to-peak is not (§10.4).

"Relative speed" must be labelled as **inertial (TEME) frame** — the
ECEF-frame figure differs by up to `ω × range` ≈ 30 m/s.

## 9. Numerical detail

### 9.1 Sampling

Specify by **interval**, not sample count, so long passes do not get
coarse. 2 s for the chart, 1 s for the CSV. JS `Date` is integer
milliseconds — verified, `t + 0.4 ms` returns an identical range — so all
sample times are on a 1 ms grid.

### 9.2 TCA and closest approach

Take the minimum sample, then fit a parabola to it and its two
neighbours. Measured with the grid deliberately offset from TCA:

| step | nearest sample | after interpolation |
|---|---|---|
| 1 s | 13.7 m | 0.002 m |
| 2 s | 54.6 m | 0.038 m |
| 5 s | 341.3 m | 1.478 m |

Against the ~0.2 m library noise floor (§5.2) this yields TCA to ~0.8 ms.
A least-squares parabola over ±10 s averages that down to ~0.25 ms.

Locate TCA from the **range minimum / ṙ zero crossing**, not from peak
elevation — oblateness and eccentricity separate them slightly.

### 9.3 Doppler rate

Central-difference the *analytic* ṙ at h ≥ 0.5 s. Noise is then
~0.006 m/s² against a ~130 m/s² signal.

## 10. Catalog

`lib/catalog.mjs` gains a `downlinks` array:

```js
downlinks: [
  { hz: 437_800_000, label: 'FM cross-band repeater', mode: 'fm',
    duty: 'on-demand', default: true },
  { hz: 145_800_000, label: 'Voice / SSTV', mode: 'fm',
    duty: 'scheduled' },
]
```

### 10.1 Tier 1 — required, rides along

NOAA-19 was decommissioned 13 August 2025 (battery 1A cell failure);
NOAA-15 and -18 went with it and POES operations ended 19 August 2025.
It is still in orbit and still tracked, so it remains a valid *visual*
target — it is simply silent.

It is currently the only `defaultMode: 'radio'` entry, and its
`viewingHint` reads *"too dim to see; use radio passes"*, which is wrong
twice over (`standardMag: 3.5` is a faint naked-eye object).

- `defaultMode: 'radio'` → `'visual'`
- rewrite `viewingHint`
- `downlinks: []`

Do **not** remove it: `selectedNoradId: 33591` appears in existing share
links.

Test updates required: `test/catalog.test.mjs:29`,
`test/satellite-seed.test.mjs:24`. The id-list assertion at
`test/catalog.test.mjs:8` and `test/magnitude.test.mjs:35` are unaffected
so long as no entry is added or removed.

### 10.2 Tier 2 — the feature

ISS gets 437.800 (repeater, default) and 145.800 (voice/SSTV). Both
verified. Hubble, BlueWalker 3, and Tiangong get `downlinks: []` —
Tiangong's CSSARC payload exists but no coordinated frequency could be
confirmed from a trustworthy source.

APRS is deliberately omitted: 145.825 is the long-standing digipeater
frequency, but packet operations have reportedly moved to 437.825 from
Zvezda. Verify before adding.

### 10.3 Tier 3 — separate change

Adding a live continuous-carrier target (SO-50 on 436.795, Meteor-M2-4
on 137.9 LRPT) changes `CATALOG.length` and the id-list assertion, needs
TLE seeding verified, and is a product decision. Not in this spec.

### 10.4 Emission duty — why it matters

The ISS cross-band repeater has **no continuous carrier**. It transmits
only while someone is uplinking on 145.990 with a 67.0 Hz tone. The chart
will draw a continuous S-curve; a recording will have gaps — and the
AOS/LOS extremes are exactly when the repeater is least likely to be in
use, so a *measured* peak-to-peak will be biased low.

Hence the `duty` field, surfaced in the chart, and the reference-elevation
Doppler readouts in §8.

## 11. Model validity

One-way Doppler is correct for a **satellite-generated carrier**: beacons,
and FM repeater downlinks (an FM repeater demodulates and re-modulates
onto its own local oscillator, so the uplink's Doppler does not carry
through).

It is **not** correct for a signal heard through a **linear transponder**,
which frequency-translates the whole passband; there the observed Doppler
is the sum of downlink and uplink Doppler, and predicting it requires the
uplink station's position. Irrelevant for today's catalog, relevant the
moment a typical amateur satellite is added.

Full-duplex uplink correction (e.g. tuning 145.990 for a QSO through the
ISS repeater) is a different calculation and is out of scope.

## 12. Observer elevation

`PassObserver` is `{ id, name, color, latDeg, lonDeg, tz }` — no
elevation — and `visibility.js:18` calls `geodeticToEcef(lat, lon, 0)`.

`lib/elevation.js` already implements an Open-Elevation lookup with an
in-memory cache and a fallback to 0, and `api.open-elevation.com` is
already in the CSP `connect-src` (`next.config.ts:54`). Its only consumer
today is `triangulate-scene.js`.

- Add `elevM?: number` to `PassObserver`, resolved lazily on add — the
  same pattern as `tz` ("resolved lazily after add; null until then").
- Thread `obs.elevM ?? 0` into `visibility.js:18` and `ratings.js`.

**Effect is modest**, contrary to an earlier draft of this design: a
2000 m site changes closest-approach range by 0.48% and shifts AOS by
0.8 s (100 m shifts it by 0.0 s). The terrestrial horizon-dip formula
`√(2h/R)` does **not** apply — the elevation angle to a satellite at
finite slant range changes by roughly `h / r_slant`, about 0.05° at 2 km.

**Two things to get right:**

- Open-Elevation returns **orthometric** height (above the geoid);
  `geodeticToEcef` wants height above the **WGS84 ellipsoid**. The geoid
  undulation runs about −105 m to +85 m globally (≈ −30 m over CONUS).
  That is 0.024% of range — below the TLE floor, so accept it, but state
  it rather than absorb it silently. Do not ship an EGM96 grid.
- The current silent `return 0` on failure is unacceptable here. The
  chart must show which elevation was used and whether it was looked up,
  defaulted, or user-supplied, and must allow a manual value.

## 13. State, sharing, export

- Store gains `radioModalObsId` / `setRadioModalObsId` alongside the
  polar pair, and `downlinkHz`.
- `selectionUpdate` in `satellite-seed.js` sets the new satellite's
  default downlink on selection; a manual override does **not** persist
  across a satellite change.
- `lib/pass-finder/state-blob.js` encodes mode as `m: "r"` but has no
  frequency field. A shared radio link would otherwise reproduce the
  chart on the wrong carrier — and the Doppler axis differs 3× between
  145.800 and 437.800. Add an `f` key; absent `f` falls back to the
  satellite's default. Extend `test/state-blob.test.mjs`.
- `polarModalFileNameFor` gains prefix and extension parameters so radio
  exports land as `radio-<satellite>-<obs>-<iso>.png`, with the CSV taking
  the same name and a `.csv` extension so a pass's two files sort together.
  The satellite is in the name because the observer alone does not identify
  a pass.
- CSV columns: `time_utc, az_deg, el_deg, ang_rate_deg_s, range_m,
  range_rate_mps, doppler_hz, rx_freq_hz, doppler_rate_hz_s, rel_signal_db`.
  `rx_freq_hz` is `downlink_hz + doppler_hz` — a rig tunes to an absolute
  frequency, not an offset. `ang_rate_deg_s` is the camera half of §1's
  joint reading and belongs in the export for the same reason it is panel 1
  on the chart. Azimuth and elevation
  are apparent (refracted, light-time retarded), for pointing. Header
  carries the TLE epoch, its age, and the detected clock skew.

## 14. Error budget

Genuine uncertainties only. Ordering **inverts with frequency** — a
single fixed budget would be wrong.

| term | 137.1 MHz | 145.8 MHz | 437.8 MHz | modelled |
|---|---|---|---|---|
| transmitter TCXO (±2.5 ppm, assumed) | ±340 Hz | ±365 Hz | ±1100 Hz | no — unknowable |
| Earth rotation | 212 Hz | 226 Hz | 678 Hz | **yes** |
| TLE velocity error (0.1–1 m/s) | 0.05–0.5 | 0.05–0.5 | 0.15–1.5 Hz | no |
| ionospheric dTEC | 0.98 Hz | 0.92 Hz | 0.31 Hz | no |
| light-time | 0.081 | 0.086 | 0.26 Hz | **yes** |
| relativistic (γ + Φ) | 0.039 | 0.041 | 0.124 Hz | yes (unobservable, §5.4) |
| tropospheric delay rate | 0.025 | 0.027 | 0.080 Hz | no |

Also unmodelled: terrain masking (dwarfs everything here), ionospheric
scintillation, tropospheric ducting, transmitter thermal drift during a
pass (0.1 ppm ≈ 44 Hz at 437.800 — plausibly the real limit on comparing
curve shape).

### 14.1 What is actually comparable to a recording

Because the transmitter offset is unknown and constant, **only the shape
of the curve is comparable**:

- peak-to-peak Δf — robust, a constant offset cancels
- maximum Doppler rate — robust, a derivative kills constants
- time of the Doppler null — robust **only if measured as the midpoint of
  the swing**. Measuring it as "where the signal crosses 437.800 MHz" is
  wrong by the offset ÷ 180 Hz/s, up to ~6 seconds. Say this on the chart.
- absolute received frequency — not comparable at all

### 14.2 Timing, for camera triggering

TLE age dominates: ISS along-track drift ~1 km/day is 0.13 s/km, so
0.07 s at half a day past epoch, 0.26 s at two days, 0.65 s at five. A
reboost invalidates a TLE outright rather than degrading it.

`parseTleEpoch` (`lib/pass-finder/tle.js:73`) is correct — proper NORAD
two-digit year windowing, correct day-of-year — but **`epochMs` never
reaches the store**, so surfacing TLE age requires threading it through.
There is no staleness guard. Note the age can be **negative** when
propagating to a time before epoch.

The browser clock may be the larger term. `clock-sync.js` estimates skew
from HTTP `Date` headers but is biased a few hundred ms by network
latency and is aimed at catching minutes-scale errors. Surface the
detected skew and state plainly that sub-second triggering needs an
NTP-disciplined clock.

`gstime` is fed UTC rather than UT1, worth up to 13.5 arcsec of Earth
rotation angle — irrelevant to Doppler, relevant to a telescope. The
TEME→ECEF rotation omits polar motion (~15 m).

## 15. Chart

`RadioModal.tsx` mirrors `PolarModal.tsx`'s lifecycle — store-driven
open/close, Escape, backdrop click, blob-URL management, copy/save
through `svgToPngBlob` (which needs no change: the painter embeds its
CSS, as `polar-modal-frame.js` does).

Opened by a radio-mode-only button in the observer card header beside the
`▲` FPS control, using the same `stop(ev)` pattern so it does not open
the polar modal underneath. Card click still opens the sky chart, which
remains useful in radio mode — it is where to point the antenna.

Three panels, one shared time axis, one vertical TCA rule through all
three:

1. **Angular rate** — °/s
2. **Doppler** — kHz offset from carrier, zero gridline emphasised
3. **Signal** — dB relative to peak

*Amended 2026-09-06, after seeing it rendered.* The original order led with
Doppler. Angular rate first groups the panels by instrument — the camera
measures the first, the radio measures the other two — and puts Doppler in
the middle, adjacent to both quantities read against it. It also reads as
the operational sequence: where to point, what to tune, how strong.
`test/radio-chart.test.mjs` pins the order.

Each panel carries a y-axis scale (top, zero, bottom on a readable tick
ladder), with the panel name above the plot and numbers alone in the left
gutter. The painter computes its own viewBox height from its content, so a
taller header cannot clip the methods block.

Header: satellite · frequency picker (catalog downlinks + freeform) ·
observer · date, plus the §8 readouts and the emission duty. Axis labels
carry UTC and observer-local time.

Methods, error budget, and elevation provenance go at the foot of the
chart, wrapped to the plot width. *Amended 2026-09-06:* the original said
"collapsible", which is not achievable — the chart is rasterised to a PNG,
so anything collapsed would simply be absent from the export.

Degrade gracefully when a satellite has no downlink and the user has
entered no frequency: draw range rate in m/s plus the angular and signal
panels, and mark the Doppler panel as needing a frequency.

### 15.1 The chart spans the full pass, not the filtered one

*Added 2026-09-06.* `minElevDeg` is a search filter. The chart and CSV span
the **full geometric pass, horizon to horizon**, and draw the threshold as a
shaded band rather than applying it.

Gating the chart on the filter let a UI control change a physical
measurement: the largest range rate is at the horizon, so a gated window
stops short of it and understates the reported swing by ~1.5% on a zenith
pass. (Not the ~6% first claimed: 92% and 98% are both fractions of the
relative speed, and dividing one by the other produced the wrong number.
Measured on the synthetic polar-orbit fixture in
`test/radio-window.test.mjs` — a different geometry from §18's real ISS
pass — peak range rate is 93.6% of orbital speed over the full window and
92.2% over a 10° one, so 92.2/93.6 = 98.5%.)

The rule lives in `lib/pass-finder/radio-window.js`. It deliberately does
**not** take the app's mode: the visual predicate also gates on
illumination, so passing it through would truncate the chart by daylight —
the same class of bug this rule exists to remove.

## 16. Implementation traps

Each of these was found by measurement, not review. Each produces
plausible-looking output.

1. **`eciToEcf` on a velocity vector** — 459 Hz. §5.1. Avoided
   structurally by computing Doppler in TEME.
2. **Solar instead of sidereal ω** — 2.0 Hz. §5.1.
3. **Central-differencing SGP4 range** — 0.3 Hz noise floor, and worse as
   the step shrinks. §5.2.
4. **Angular rate from alt/az** — returns 0 at zenith. §6.
5. **`correctRefraction` used for true→apparent** — it is the inverse.
   §6.
6. **Charting the joint window instead of the observer's own** — truncates
   the curve, understates Δf. §4.1.
7. **Sub-millisecond sampling** — JS `Date` is integer ms; `t + 0.4 ms`
   is `t`.
8. **Assuming Doppler symmetry** — up to 4.88% asymmetric.
9. **Double unit conversion** — satellite.js returns km and km/s.
10. **Two propagation paths** — refactor `issEcefAt` to return state
    rather than adding a parallel sampler that can drift out of sync.

Also note: light-time makes the radio chart's apparent position differ
from the polar chart's by 5.3 arcsec. Harmless; document it so it is not
mistaken for a bug.

## 17. Testing

`test/radio-pass.test.mjs`, matching the flat `test/*.test.mjs`
convention and Node's built-in runner.

**Required regression tests:**

- **Geostationary range rate ≈ 0.** A GEO satellite is stationary in
  ECEF, so `|ṙ| < 1 m/s` from any ground station. Measured: correct
  handling gives −0.13 m/s, the naive velocity gives −341 m/s. This
  catches both the missing `ω × r` term *and* its sign — a sign error
  reads ≈ +680 m/s.
- **Zenith angular rate is non-zero.** A pass through exact zenith must
  return ω_max ≈ v/d, not 0.
- **Doppler sign.** Approaching gives a higher received frequency.

**Accuracy tests against a synthetic straight-line target** (closed-form
range, range rate, angular rate, and path loss): the sampler's outputs to
tight tolerance without SGP4 in the loop.

**Oracle tolerance.** Validating the analytic ṙ against central
differences requires `h ≈ 1 s` and a tolerance of ~0.25 m/s, *not* the
sub-mm/s that a clean analytic model suggests — the library's ~0.2 m
range noise floor makes anything tighter unachievable. Prefer validating
against an independent analytic Kepler model.

Plus: TCA interpolation accuracy, `relSignalDb == 0` at peak, light-time
null lag, catalog `downlinks` shape, `state-blob` round-trip with and
without `f`.

## 18. Reference figures

Measured with satellite.js 6.0.2 and a real ISS TLE unless noted.

**ISS, 437.800 MHz:**

| quantity | value |
|---|---|
| max Doppler, best geometry | ±10.94 kHz (\|ṙ\| = 7492 m/s) |
| ceiling (full orbital speed 7661 m/s) | 11.19 kHz |
| zenith equatorial pass | ±10.1 kHz |
| real 46.8° pass over Chicago | ±9.64 kHz, 19.27 kHz p-p |
| max Doppler rate, zenith | 180 Hz/s |
| max Doppler rate, 46.8° pass | 134.5 Hz/s |
| ω_max, zenith (d = 412.9 km) | 1.024 °/s |
| ω_max, 46.8° pass (d = 554.6 km) | 0.761 °/s |
| FSPL peak→edge | −11.0 dB (10° cutoff), −15.0 dB (0°) |
| absolute FSPL at 420 km | 137.7 dB |

Same maximising geometry: ±3.64 kHz on 145.800, ±3.43 kHz on 137.100.
Doppler rate and ω_max both scale as `1/d`, confirmed to 0.3% between the
zenith and Chicago cases.

**Context:** an aircraft at 10 km doing 7.7 km/s would sweep 44.1 °/s —
**43× faster** than the ISS's 1.02 °/s — crossing the sky in a few
seconds rather than several minutes.

## 19. Known limitations to state in the UI

- `isRadioReachable` gates on **optical** refraction
  (`apparentAltDeg`). Radio refraction is ~10–15% larger because radio
  refractivity carries a water-vapour term optics lacks: ~0.7′ more at
  10°, ~5–8′ at the horizon. Affects window-edge timing only — ~0.15 s at
  a 10° cutoff, ~1.2 s at 0°. Not worth a radio refraction model; worth
  naming.
- The pass search walks at 60 s (`pass-finder-scene.js:1594`) and catches
  a window of duration D with probability ~`min(1, D/60)`. Duration
  scales as `√(peak − minElev)`, so only passes peaking within ~0.4° of
  the cutoff are at risk — roughly 1–2%. A smaller `stepMs` in radio mode
  is a one-argument fix if wanted.
- SGP4's real-world accuracy against an actual observation is not
  verified here. The transmitter oscillator spec is assumed. Ionospheric
  figures assume a 20 TECU swing, which a geomagnetic storm can multiply
  several-fold.

## 20. Build order

1. `satState` refactor of `issEcefAt` + the GEO regression test.
2. Sampler (§4–§9) + synthetic-target tests.
3. Catalog Tier 1 + Tier 2, with the test updates in §10.1.
4. Store, `state-blob` `f` key, observer `elevM`.
5. Painter + `RadioModal` + the card button.
6. CSV export.
7. Error budget, provenance, and methods panel.
