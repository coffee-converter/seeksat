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

/** `badge`, plus `badge--warn|danger|ok` for a tone. */
export function badgeClass(tone = 'neutral') {
  return cx('badge', tone !== 'neutral' && `badge--${tone}`);
}

/** The value an arrow key (or Home/End) moves a segmented control to; other keys keep `current`. */
export function segmentedNext(values, current, key) {
  const n = values.length;
  if (!n) return current;
  const at = Math.max(0, values.indexOf(current));
  if (key === 'ArrowRight' || key === 'ArrowDown') return values[(at + 1) % n];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return values[(at - 1 + n) % n];
  if (key === 'Home') return values[0];
  if (key === 'End') return values[n - 1];
  return current;
}

/** `modal`, plus `modal--full` for the full-screen takeover and `theme-dark` for an always-dark dialog. */
export function modalClass({ size = 'dialog', tone = 'page' } = {}) {
  return cx('modal', size === 'full' && 'modal--full', tone === 'dark' && 'theme-dark');
}
