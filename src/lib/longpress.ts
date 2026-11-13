// Long-press opens context menus on touch screens.
//
// iOS Safari never fires `contextmenu` for a long press, so holding a finger
// still for HOLD_MS dispatches one on the pressed element. Every existing
// `@contextmenu` handler then works on phones without changes. Android does
// fire its own; whichever arrives first wins and the other is dropped. The
// tap events that follow the press are swallowed so letting go doesn't also
// play the row or close the sheet that just opened.

const HOLD_MS = 480;
const SLOP = 10;

export function installLongPress() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let press: { id: number; x: number; y: number } | null = null;
  /** True from the moment a menu opened until the next press starts. */
  let fired = false;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  document.addEventListener("pointerdown", (e) => {
    fired = false;
    cancel();
    if (e.pointerType !== "touch" || !e.isPrimary) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    const target = e.target as Element;
    timer = setTimeout(() => {
      timer = undefined;
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: press?.x ?? e.clientX, clientY: press?.y ?? e.clientY, view: window });
      target.dispatchEvent(event);
      // Only treat it as a menu press if a handler took it.
      if (event.defaultPrevented) {
        fired = true;
        navigator.vibrate?.(8);
      }
    }, HOLD_MS);
  }, { passive: true });

  document.addEventListener("pointermove", (e) => {
    if (!press || e.pointerId !== press.id || !timer) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancel();
  }, { passive: true });

  const release = (e: PointerEvent) => {
    if (press && e.pointerId === press.id) {
      press = null;
      cancel();
    }
  };
  document.addEventListener("pointerup", release, { passive: true });
  document.addEventListener("pointercancel", release, { passive: true });
  // A scroll that starts during the hold isn't a long press.
  document.addEventListener("scroll", cancel, { passive: true, capture: true });

  window.addEventListener("contextmenu", (e) => {
    if (!e.isTrusted || !press) return;
    if (fired) {
      // Ours already opened a menu for this press.
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    // The browser's came first (Android): let it through and don't send ours.
    cancel();
    fired = true;
  }, { capture: true });

  for (const type of ["mousedown", "mouseup", "click"]) {
    window.addEventListener(type, (e) => {
      if (!fired) return;
      e.preventDefault();
      e.stopPropagation();
    }, { capture: true });
  }
}
