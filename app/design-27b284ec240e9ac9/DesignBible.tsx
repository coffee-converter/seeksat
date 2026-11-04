"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { MODES, applyMode, readMode, readNight, themeControlHint, writeMode } from "@/lib/ui/theme.mjs";
import { useResolvedTheme } from "@/lib/ui/use-theme";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { Details, Disclosure } from "@/components/ui/Disclosure";
import Field from "@/components/ui/Field";
import Modal from "@/components/ui/Modal";
import RatingBars from "@/components/ui/RatingBars";
import Segmented from "@/components/ui/Segmented";
import StatTile from "@/components/ui/StatTile";
import Surface from "@/components/ui/Surface";
import NightToggle from "@/components/NightToggle";

export type Cell = { value: string; resolved: string; kind: "color" | "channels" | "shadow" | "other"; inherited: boolean };
export type ColorRow = { name: string; source: "globals.css" | "map-tokens.mjs" | "chart-tokens.mjs"; dark: Cell; light: Cell };
export type ColorGroup = { title: string; rows: ColorRow[] };
export type Swatch = { name: string; value: string };
export type Palette = { title: string; source: string; note?: string; columns: { label: string; swatches: Swatch[] }[] };
export type Token = { name: string; value: string };
export type BibleData = { colors: ColorGroup[]; scale: Token[]; reducedMotion: Token[]; nightFilter: string; palettes: Palette[] };

type Mode = "auto" | "light" | "dark";
const MODE_LABEL: Record<Mode, string> = { auto: "Auto", light: "Light", dark: "Dark" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

const SECTIONS = [
  ["font", "Font"], ["type", "Type scale"], ["colour", "Colour"], ["spacing", "Spacing"], ["radius", "Radius"],
  ["borders", "Borders"], ["shadows", "Shadows"], ["motion", "Motion"], ["components", "Components"],
] as const;

const SAMPLE = "The ISS rises in the north-west at 21:04, climbs to 72° and fades into shadow two minutes later. Bring binoculars.";
const IS_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i;

/** Auto / Light / Dark through lib/ui/theme.mjs, as the site's own ThemeToggle does. */
function ThemeSwitch() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [night, setNight] = useState(false);
  useEffect(() => {
    setMode(readMode() as Mode);
    setNight(readNight());
    const onTheme = () => setNight(readNight());
    window.addEventListener("seeksat:theme", onTheme);
    return () => window.removeEventListener("seeksat:theme", onTheme);
  }, []);
  const choose = useCallback((next: Mode) => {
    setMode(next);
    writeMode(next);
    const theme = applyMode(document, next, window.matchMedia(DARK_QUERY).matches);
    window.dispatchEvent(new CustomEvent("seeksat:theme", { detail: theme }));
  }, []);
  return (
    <Segmented
      label="Theme"
      description={themeControlHint(night)}
      options={(MODES as Mode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
      value={mode}
      onChange={choose}
    />
  );
}

function Section({ id, title, lede, children }: { id: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="bible__section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="bible__h2">{title}</h2>
      {lede ? <p className="bible__lede">{lede}</p> : null}
      {children}
    </section>
  );
}

function Specimen({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="bible__specimen">
      <h3 className="bible__h3">{title}</h3>
      {note ? <p className="bible__note">{note}</p> : null}
      {children}
    </div>
  );
}

const Code = ({ children }: { children: ReactNode }) => <code className="bible__code">{children}</code>;

function tokensOf(scale: Token[], prefix: string) {
  return scale.filter((t) => t.name.startsWith(prefix));
}

/** One theme's value of a colour token: the swatch (in that theme's colour) and the declared value. */
function ColorCell({ cell, theme }: { cell: Cell; theme: string }) {
  let look: CSSProperties | null = null;
  if (cell.kind === "color") look = { background: cell.resolved };
  else if (cell.kind === "channels") look = { background: `rgb(${cell.resolved})` };
  else if (cell.kind === "shadow") look = { boxShadow: cell.resolved };
  return (
    <div className="bible__cell">
      <span className="bible__theme-tag">{theme}</span>
      {look ? <span className={cell.kind === "shadow" ? "bible__chip bible__chip--shadow" : "bible__chip"} style={look} aria-hidden="true" /> : null}
      <span className="bible__value">
        <Code>{cell.value}</Code>
        {cell.resolved !== cell.value ? <span className="bible__resolved">{cell.resolved}</span> : null}
        {cell.inherited ? <span className="bible__resolved">not set in light: inherited</span> : null}
      </span>
    </div>
  );
}

function SwatchList({ swatches }: { swatches: Swatch[] }) {
  return (
    <ul className="bible__swatches">
      {swatches.map((s) => (
        <li key={s.name} className="bible__swatch">
          {IS_COLOR.test(s.value) ? <span className="bible__chip" style={{ background: s.value }} aria-hidden="true" /> : null}
          <span className="bible__value">
            <span className="bible__name">{s.name}</span>
            <Code>{s.value}</Code>
          </span>
        </li>
      ))}
    </ul>
  );
}

type ModalKind = null | "page" | "dark" | "wide" | "bare" | "full";

export default function DesignBible({ data }: { data: BibleData }) {
  const theme = useResolvedTheme();
  const [seg, setSeg] = useState<"globe" | "mercator">("globe");
  const [segSm, setSegSm] = useState<"visual" | "radio" | null>(null);
  const [pressed, setPressed] = useState(true);
  const [more, setMore] = useState(false);
  const [focusChip, setFocusChip] = useState(1);
  const [hiddenChip, setHiddenChip] = useState(2);
  const [modal, setModal] = useState<ModalKind>(null);
  const close = () => setModal(null);

  const fs = tokensOf(data.scale, "--fs-");
  // The chips take the satellite palette of the theme on show, as the map does.
  const satPalette = data.palettes[0]?.columns[theme === "light" ? 1 : 0]?.swatches.map((s) => s.value) ?? ["var(--accent)"];

  return (
    <div className="bible">
      <header className="bible__bar">
        <div className="bible__brand">
          <span className="bible__wordmark"><span className="bible__seek">Seek</span><span className="bible__sat">Sat</span></span>
          <span className="bible__subtitle">Design bible</span>
        </div>
        <div className="bible__switches">
          <ThemeSwitch />
          <NightToggle />
        </div>
      </header>

      <nav className="bible__nav" aria-label="Sections">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="bible__nav-link">{label}</a>)}
      </nav>

      <main className="bible__main">
        <p className="bible__intro">
          Every token and every <Code>components/ui</Code> part, rendered live. Token names and values are read from the
          theme-tokens block of <Code>app/globals.css</Code> when the site builds, so this page cannot drift from it.
        </p>

        <Section id="font" title="Font" lede={<>Atkinson Hyperlegible Next for all text and numbers (<Code>--font-sans</Code>, <Code>--font-num</Code>), self-hosted through next/font.</>}>
          <Surface>
            <p className="bible__sample">{SAMPLE}</p>
            <p className="bible__digits num">0123456789 0O 1lI</p>
            <ul className="bible__stack">
              {tokensOf(data.scale, "--fw-").map((t) => (
                <li key={t.name} className="bible__spec-row">
                  <span className="bible__spec-sample" style={{ fontWeight: `var(${t.name})`, fontSize: "var(--fs-lg)" }}>Satellite pass at 21:04</span>
                  <span className="bible__spec-meta"><Code>{t.name}</Code> {t.value}</span>
                </li>
              ))}
            </ul>
          </Surface>
          <div className="bible__grid">
            {tokensOf(data.scale, "--font-").map((t) => (
              <Surface key={t.name}>
                <p className="bible__spec-sample" style={{ fontFamily: `var(${t.name})`, fontSize: "var(--fs-xl)" }}>
                  {t.name === "--font-brand" ? "SeekSat" : t.name === "--font-code" ? "25544 ISS (ZARYA)" : "Aa 0123456789"}
                </p>
                <p className="bible__spec-meta"><Code>{t.name}</Code></p>
                <p className="bible__resolved">{t.value}</p>
              </Surface>
            ))}
          </div>
        </Section>

        <Section
          id="type"
          title="Type scale"
          lede={<>Six steps and one hero step. The base is 13px (<Code>--fs-md</Code>): Task 4 checked Atkinson at 13px on the real screens at 360 and desktop and kept it, so the scale did not move up 1px. Form controls on touch screens use <Code>--fs-input</Code> (16px) so iOS does not zoom.</>}
        >
          <Surface>
            <ul className="bible__stack">
              {fs.map((t) => (
                <li key={t.name} className={t.name === "--fs-hero" ? "bible__spec-row bible__hero" : "bible__spec-row"}>
                  <span className="bible__spec-sample" style={{ fontSize: `var(${t.name})` }}>
                    {t.name === "--fs-hero" ? "72°" : "Pass at 21:04, 72° max"}
                  </span>
                  <span className="bible__spec-meta">
                    <Code>{t.name}</Code> {t.value}
                    {t.name === "--fs-hero" ? " (scales with its container)" : null}
                  </span>
                </li>
              ))}
            </ul>
          </Surface>
          <div className="bible__grid">
            {tokensOf(data.scale, "--lh-").map((t) => (
              <Surface key={t.name}>
                <p className="bible__spec-sample" style={{ lineHeight: `var(${t.name})` }}>{SAMPLE}</p>
                <p className="bible__spec-meta"><Code>{t.name}</Code> {t.value}</p>
              </Surface>
            ))}
          </div>
        </Section>

        <Section
          id="colour"
          title="Colour"
          lede={<>Every colour token in both themes, whatever theme this page is in. Values are as declared, with what they resolve to beneath. Night vision is not a palette: it forces dark and runs one filter over the page (<Code>--night-filter</Code>: {data.nightFilter}).</>}
        >
          {data.colors.map((g) => (
            <Specimen key={g.title} title={g.title}>
              <ul className="bible__tokens">
                <li className="bible__token bible__token--head" aria-hidden="true"><span>Token</span><span>Dark</span><span>Light</span></li>
                {g.rows.map((r) => (
                  <li key={r.name} className="bible__token">
                    <span className="bible__token-name">
                      <Code>{r.name}</Code>
                      {r.source !== "globals.css" ? <span className="bible__resolved">from lib/ui/{r.source}</span> : null}
                    </span>
                    <ColorCell cell={r.dark} theme="Dark" />
                    <ColorCell cell={r.light} theme="Light" />
                  </li>
                ))}
              </ul>
            </Specimen>
          ))}
          <h3 className="bible__h3">Palettes in JavaScript</h3>
          <p className="bible__note">Imported from the modules that paint the map and the charts.</p>
          <div className="bible__grid bible__grid--wide">
            {data.palettes.map((p) => (
              <Surface key={p.title}>
                <h4 className="bible__h4">{p.title}</h4>
                <p className="bible__resolved">{p.source}</p>
                {p.note ? <p className="bible__note">{p.note}</p> : null}
                <div className="bible__columns">
                  {p.columns.map((c) => (
                    <div key={c.label}>
                      <p className="bible__theme-tag">{c.label}</p>
                      <SwatchList swatches={c.swatches} />
                    </div>
                  ))}
                </div>
              </Surface>
            ))}
          </div>
        </Section>

        <Section id="spacing" title="Spacing" lede="Padding, margins and gaps use these steps only.">
          <Surface>
            <ul className="bible__stack">
              {tokensOf(data.scale, "--sp-").map((t) => (
                <li key={t.name} className="bible__measure">
                  <span className="bible__spec-meta"><Code>{t.name}</Code> {t.value}</span>
                  <span className="bible__space" style={{ width: `var(${t.name})` }} aria-hidden="true" />
                </li>
              ))}
            </ul>
          </Surface>
        </Section>

        <Section id="radius" title="Radius" lede="4 for small marks and badges, 6 for buttons and inputs, 8 for cards and tiles, 12 for dialogs, full for pills and dots.">
          <div className="bible__grid bible__grid--tight">
            {tokensOf(data.scale, "--radius-").map((t) => (
              <div key={t.name} className="bible__tile">
                <span className="bible__shape" style={{ borderRadius: `var(${t.name})` }} aria-hidden="true" />
                <span className="bible__spec-meta"><Code>{t.name}</Code> {t.value}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="borders" title="Borders" lede="One pixel, three strengths: hairlines, control outlines, and the 3:1 edge of a field.">
          <div className="bible__grid bible__grid--tight">
            {tokensOf(data.scale, "--line-").map((t) => (
              <div key={t.name} className="bible__tile">
                <span className="bible__shape bible__shape--line" style={{ border: `var(${t.name})` }} aria-hidden="true" />
                <span className="bible__spec-meta"><Code>{t.name}</Code></span>
                <span className="bible__resolved">{t.value}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="shadows" title="Shadows" lede="Two elevations, set per theme (values under Colour, Elevation).">
          <div className="bible__grid bible__grid--tight">
            {["--shadow-popover", "--shadow-modal"].map((name) => (
              <div key={name} className="bible__tile">
                <span className="bible__shape bible__shape--raised" style={{ boxShadow: `var(${name})` }} aria-hidden="true" />
                <span className="bible__spec-meta"><Code>{name}</Code></span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="motion"
          title="Motion"
          lede={<>Hover or focus a sample to run it. One easing, <Code>--ease</Code> ({tokensOf(data.scale, "--ease")[0]?.value}). With reduced motion: {data.reducedMotion.map((t) => `${t.name} ${t.value}`).join(", ")}.</>}
        >
          <div className="bible__grid bible__grid--tight">
            {tokensOf(data.scale, "--dur-").map((t) => (
              <div key={t.name} className="bible__motion" tabIndex={0} aria-label={`${t.name} sample`}>
                <span className="bible__track" aria-hidden="true">
                  <span className="bible__dot" style={{ transition: `transform var(${t.name}) var(--ease)` }} />
                </span>
                <span className="bible__spec-meta"><Code>{t.name}</Code> {t.value}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="components" title="Components" lede={<>Each part from <Code>components/ui</Code> in its variants and states. Hover and focus are live: use the mouse or Tab.</>}>
          {(["primary", "secondary", "quiet", "link", "overlay"] as const).map((variant) => (
            <Specimen key={variant} title={`Button, ${variant}`} note={variant === "overlay" ? "Sits on the map, so it has an opaque backing." : undefined}>
              {(["md", "sm"] as const).map((size) => (
                <div key={size} className={variant === "overlay" ? "bible__row bible__row--map" : "bible__row"}>
                  <span className="bible__row-label">{size}</span>
                  <Button variant={variant} size={size}>Default</Button>
                  <Button variant={variant} size={size} disabled>Disabled</Button>
                  <Button variant={variant} size={size} pressed={pressed} onClick={() => setPressed((p) => !p)}>Pressed</Button>
                  <Button variant={variant} size={size} pressed pressedLook="accent">Pressed, accent</Button>
                  <Button variant={variant} size={size} on>On</Button>
                  <Button variant={variant} size={size} tone="danger">Danger</Button>
                  <Button variant={variant} size={size} done>Done</Button>
                  <Button variant={variant} size={size} iconOnly aria-label="Close"><span aria-hidden="true">✕</span></Button>
                </div>
              ))}
            </Specimen>
          ))}
          <p className="bible__note">
            Pressed sets aria-pressed (a toggle; click it). On shows the same look without aria-pressed, for a label that already says its state. A link never fills: pressed or on, it turns bold with a firmer underline. Done on a primary keeps the fill and its text; the label change carries the cue. Icon-only buttons must carry an aria-label.
          </p>

          <Specimen title="Segmented" note="A radiogroup: one tab stop, arrow keys move and select.">
            <div className="bible__row">
              <span className="bible__row-label">md</span>
              <Segmented label="Map view" options={[{ value: "globe", label: "Globe" }, { value: "mercator", label: "Mercator" }]} value={seg} onChange={setSeg} />
            </div>
            <div className="bible__row">
              <span className="bible__row-label">sm</span>
              <Segmented size="sm" label="Mode" options={[{ value: "visual", label: "Visual" }, { value: "radio", label: "Radio" }]} value={segSm} onChange={setSegSm} />
              <span className="bible__note">nothing chosen yet</span>
            </div>
            <div className="bible__row">
              <span className="bible__row-label">disabled</span>
              <Segmented size="sm" label="Units" options={[{ value: "km", label: "km" }, { value: "mi", label: "mi" }, { value: "nm", label: "nmi", disabled: true }]} value="km" onChange={() => {}} />
            </div>
          </Specimen>

          <Specimen title="Badge">
            <div className="bible__row">
              <Badge>Neutral</Badge>
              <Badge tone="warn">Old data</Badge>
              <Badge tone="danger">Stale</Badge>
              <Badge tone="ok">Live</Badge>
              <span className="bible__tint" style={{ color: "var(--q4)" }}>
                <Badge tone="rating"><RatingBars bars={4} label="4 of 5" /> Great</Badge>
              </span>
            </div>
          </Specimen>

          <Specimen title="RatingBars" note="Bar count carries the rating; colour backs it up.">
            <div className="bible__row">
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <span key={n} className="bible__labelled">
                  <RatingBars bars={n} label={`${n} of 5`} />
                  <span className="bible__spec-meta">{n}</span>
                </span>
              ))}
            </div>
          </Specimen>

          <Specimen title="Chip" note="Normal, focused and hidden; the eye hides it on the map. Click to try.">
            <ul className="bible__chips">
              {["ISS (ZARYA)", "NOAA 19", "Hubble", "Starlink-1007"].map((label, i) => (
                <Chip
                  key={label}
                  color={satPalette[i % satPalette.length]}
                  label={label}
                  focused={focusChip === i}
                  hidden={hiddenChip === i}
                  onSelect={() => setFocusChip(i)}
                  onToggleHidden={i === 3 ? undefined : () => setHiddenChip((h) => (h === i ? -1 : i))}
                />
              ))}
            </ul>
          </Specimen>

          <Specimen title="StatTile" note="sm, md and lg; lg uses the container-scaled hero step.">
            <div className="bible__grid bible__grid--tight bible__grid--start">
              <StatTile size="sm" label="Range" value="1,284" unit="km" />
              <StatTile label="Elevation" value="42.7°" note="rising" />
              <StatTile label="Passes" value="6" note="link to a section" href="#components" />
            </div>
            <div className="bible__wide-tile">
              <StatTile size="lg" label="Next pass" value="21:04" note="in 2 h 13 min" />
            </div>
          </Specimen>

          <Specimen title="Field" note="Input and select; a hint, an error, a hidden label, disabled.">
            <div className="bible__grid">
              <Field label="Location" hint="A city, or lat, lon">
                <input type="text" placeholder="Chicago" />
              </Field>
              <Field label="Frequency (MHz)" error="Enter a number between 30 and 3000">
                <input type="text" defaultValue="14x.800" />
              </Field>
              <Field label="Minimum elevation">
                <select defaultValue="10">
                  <option value="0">0°</option>
                  <option value="10">10°</option>
                  <option value="30">30°</option>
                </select>
              </Field>
              <Field label="Search satellites" hideLabel>
                <input type="search" placeholder="Search satellites (label hidden)" />
              </Field>
              <Field label="Disabled">
                <input type="text" defaultValue="Read only here" disabled />
              </Field>
            </div>
          </Specimen>

          <Specimen title="Surface" note="The card look, padded or flush.">
            <div className="bible__grid">
              <Surface><p>Padded surface.</p></Surface>
              <Surface padded={false}>
                <ul className="bible__flush">
                  <li>Flush surface:</li>
                  <li>a list or grid runs</li>
                  <li>edge to edge.</li>
                </ul>
              </Surface>
            </div>
          </Specimen>

          <Specimen title="Disclosure" note="The ⋯ button reveals less-used actions into the same row.">
            <div className="bible__row">
              <Button size="sm">Sky chart</Button>
              <Button size="sm">Remind me</Button>
              <Disclosure id="bible-more" open={more} onToggle={() => setMore((o) => !o)} label="the 21:04 pass">
                <Button size="sm">Radio chart</Button>
                <Button size="sm">Print</Button>
              </Disclosure>
            </div>
          </Specimen>

          <Specimen title="Details" note="A native fold, closed and open.">
            <div className="bible__grid">
              <Details summary="How passes are rated"><p className="bible__note">Closed by default.</p></Details>
              <Details summary="What the numbers mean" defaultOpen><p className="bible__note">Open by default.</p></Details>
            </div>
          </Specimen>

          <Specimen title="Modal" note="Page and dark tones, wide, untitled, and full screen. Esc or Close shuts it; focus is trapped inside.">
            <div className="bible__row">
              <Button onClick={() => setModal("page")}>Page dialog</Button>
              <Button onClick={() => setModal("dark")}>Dark dialog</Button>
              <Button onClick={() => setModal("wide")}>Dark, wide</Button>
              <Button onClick={() => setModal("bare")}>Untitled, with actions</Button>
              <Button onClick={() => setModal("full")}>Full screen</Button>
            </div>
          </Specimen>
        </Section>
      </main>

      <Modal open={modal === "page"} onClose={close} title="Page dialog">
        <ModalBody />
      </Modal>
      <Modal open={modal === "dark"} onClose={close} title="Dark dialog" tone="dark">
        <ModalBody />
      </Modal>
      <Modal open={modal === "wide"} onClose={close} title="Dark, wide" tone="dark" wide>
        <ModalBody wide />
      </Modal>
      <Modal open={modal === "bare"} onClose={close} title="Untitled dialog" hideTitle actions={<><Button size="sm">Save PNG</Button><Button size="sm">CSV</Button></>}>
        <ModalBody />
      </Modal>
      <Modal open={modal === "full"} onClose={close} title="Full screen" size="full">
        <ModalBody />
      </Modal>
    </div>
  );
}

function ModalBody({ wide = false }: { wide?: boolean }) {
  return (
    <div className={wide ? "bible__modal-body bible__modal-body--wide" : "bible__modal-body"}>
      <p>{SAMPLE}</p>
      <div className="bible__grid bible__grid--tight">
        <StatTile size="sm" label="Max" value="72°" />
        <StatTile size="sm" label="Duration" value="6:12" />
      </div>
      <Field label="Frequency (MHz)" hint="Downlink">
        <input type="text" defaultValue="145.800" />
      </Field>
      <div className="bible__row">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
      </div>
    </div>
  );
}
