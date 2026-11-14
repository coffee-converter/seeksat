/** Gives focus back to an opener. When it cannot take focus yet (hidden
 *  behind the docked live view until the close re-renders the panel), it
 *  tries again on the next frame. */
export function refocus(el: HTMLElement | null): void {
  if (!el) return;
  el.focus();
  if (document.activeElement === el) return;
  requestAnimationFrame(() => {
    if (el.isConnected) el.focus();
  });
}
