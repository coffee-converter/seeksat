// Class-name helpers for the UI library (components/ui). Pure, so node:test can cover them.

/** Joins the truthy parts with spaces. */
export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** `btn` plus only the modifiers that differ from the defaults. */
export function buttonClass({ variant = 'secondary', size = 'md', iconOnly = false, tone = 'default', done = false, pressedLook = 'fill', on = false } = {}) {
  return cx(
    'btn',
    variant !== 'secondary' && `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    iconOnly && 'btn--icon',
    tone !== 'default' && `btn--${tone}`,
    done && 'btn--done',
    pressedLook === 'accent' && 'btn--accent-pressed',
    on && 'btn--on',
  );
}

/** `surface` (the card look) plus its modifiers. padded: true (12 px), 'sm'
 *  (8 / 12 px) or false (flush). accent: a coloured leading edge, from
 *  --surface-accent. selected: a firmer edge and ring. interactive: the whole
 *  surface is a button (hover fill, focus ring).
 *  @param {{ padded?: boolean | 'sm', accent?: boolean, selected?: boolean, interactive?: boolean }} [o] */
export function surfaceClass({ padded = true, accent = false, selected = false, interactive = false } = {}) {
  return cx(
    'surface',
    padded === true && 'surface--padded',
    padded === 'sm' && 'surface--padded-sm',
    accent && 'surface--accent',
    selected && 'surface--selected',
    interactive && 'surface--interactive',
  );
}

/** `badge`, plus `badge--warn|danger|ok` for a tone. */
export function badgeClass(tone = 'neutral') {
  return cx('badge', tone !== 'neutral' && `badge--${tone}`);
}

/** The library's text link look (Button variant="link"), for an <a>. */
export function linkClass() {
  return buttonClass({ variant: 'link' });
}

/** The value an arrow key (or Home/End) moves a segmented control to; other
 *  keys, and any key held with Alt, Meta or Ctrl (browser and OS shortcuts),
 *  keep `current`. With nothing chosen (`current` not among `values`), the
 *  forward arrows land on the first value and the back arrows on the last. */
export function segmentedNext(values, current, key, { altKey = false, metaKey = false, ctrlKey = false } = {}) {
  const n = values.length;
  if (!n || altKey || metaKey || ctrlKey) return current;
  const at = values.indexOf(current);
  if (key === 'ArrowRight' || key === 'ArrowDown') return values[at < 0 ? 0 : (at + 1) % n];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return values[at < 0 ? n - 1 : (at - 1 + n) % n];
  if (key === 'Home') return values[0];
  if (key === 'End') return values[n - 1];
  return current;
}

/** `modal`, plus `modal--full` for the full-screen takeover and `theme-dark` for an always-dark dialog. */
export function modalClass({ size = 'dialog', tone = 'page' } = {}) {
  return cx('modal', size === 'full' && 'modal--full', size === 'sheet' && 'modal--sheet', tone === 'dark' && 'theme-dark');
}
