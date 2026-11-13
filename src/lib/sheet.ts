// Drag-to-dismiss for bottom sheets on the phone layout.
//
// The sheet follows the finger 1:1, rubber-bands when pulled up past the top,
// and on release projects the flick forward (Apple's deceleration formula) to
// decide between closing and snapping back. The settle animation is a CSS
// transition whose curve starts at the finger's speed, so there's no seam
// between dragging and animating. Grabbing a sheet while it's still sliding in
// picks it up from where it is on screen.
//
// Use the returned `enter`/`leave` as JS hooks on a <Transition :css="false">
// and `onPointerDown` on the sheet (or just its handle).
import type { Ref } from "vue";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
/** Slope of EASE at t=0: the curve starts this many times faster than linear. */
const EASE_SLOPE = 0.72 / 0.32;
const OPEN_MS = 460;
const MIN_MS = 180;
/** Movement before a press becomes a drag, so taps and horizontal swipes still work. */
const SLOP = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where a flick would come to rest, px from the release point. UIScrollView's normal rate. */
function project(velocity: number, rate = 0.998) {
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** Resistance past an edge: follows less the further it goes, never stops dead. */
function rubberband(over: number, size: number, c = 0.55) {
  return (over * size * c) / (size + c * over);
}

function currentY(el: HTMLElement) {
  const t = getComputedStyle(el).transform;
  return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0;
}

export interface SheetOptions {
  sheet: Ref<HTMLElement | undefined>;
  /** Called when a drag or flick should close the sheet. Flip the v-if here. */
  dismiss: () => void;
  /** 0 when open, 1 when closed, with the duration of the move (0 while dragging). For scrims. */
  progress?: (p: number, ms: number) => void;
  /** Presses that start inside these never drag the sheet (scrubbers, scroll lists). */
  ignore?: string;
}

export function useSheetDrag(opts: SheetOptions) {
  let releaseVelocity = 0;
  let leaving = false;
  let settle: { el: HTMLElement; timer: ReturnType<typeof setTimeout>; onEnd: (e: TransitionEvent) => void; done?: () => void } | null = null;
  let gesture: { id: number; x: number; y: number; base: number; dragging: boolean; samples: { t: number; y: number }[] } | null = null;

  const height = (el: HTMLElement) => el.getBoundingClientRect().height || window.innerHeight;

  function place(el: HTMLElement, y: number) {
    el.style.transform = `translate3d(0, ${y}px, 0)`;
    opts.progress?.(clamp(y / height(el), 0, 1), 0);
  }

  /** Ends any running settle animation where it is. Its callback still runs, so Vue isn't left waiting. */
  function stopSettle() {
    if (!settle) return;
    const { el, timer, onEnd, done } = settle;
    settle = null;
    clearTimeout(timer);
    el.removeEventListener("transitionend", onEnd);
    done?.();
  }

  /** Slides to `to`, starting at `velocity` px/s when there is one. */
  function animate(el: HTMLElement, to: number, velocity: number, done?: () => void) {
    stopSettle();
    const from = currentY(el);
    const distance = Math.abs(to - from);
    const ms = velocity && distance ? clamp(((EASE_SLOPE * distance) / Math.abs(velocity)) * 1000, MIN_MS, OPEN_MS) : OPEN_MS;
    opts.progress?.(clamp(to / height(el), 0, 1), ms);
    const finish = () => {
      if (!to) el.style.transform = "";
      el.style.transition = "";
    };
    if (distance < 0.5) {
      el.style.transition = "none";
      el.style.transform = `translate3d(0, ${to}px, 0)`;
      finish();
      done?.();
      return;
    }
    el.style.transition = `transform ${ms}ms ${EASE}`;
    el.style.transform = `translate3d(0, ${to}px, 0)`;
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "transform") end();
    };
    const end = () => {
      settle = null;
      clearTimeout(timer);
      el.removeEventListener("transitionend", onEnd);
      finish();
      done?.();
    };
    // transitionend can go missing (element hidden mid-flight), so a timer backs it up.
    const timer = setTimeout(end, ms + 120);
    el.addEventListener("transitionend", onEnd);
    settle = { el, timer, onEnd, done };
  }

  function enter(_: Element, done: () => void) {
    const el = opts.sheet.value;
    if (!el) return done();
    leaving = false;
    el.style.transition = "none";
    place(el, height(el));
    el.getBoundingClientRect(); // commit the start position before transitioning
    animate(el, 0, 0, done);
  }

  function leave(_: Element, done: () => void) {
    const el = opts.sheet.value;
    if (!el) return done();
    leaving = true;
    const v = Math.max(0, releaseVelocity);
    releaseVelocity = 0;
    animate(el, height(el), v, () => {
      leaving = false;
      done();
    });
  }

  function begin(el: HTMLElement, e: PointerEvent) {
    stopSettle();
    el.style.transition = "none";
    gesture!.dragging = true;
    gesture!.base = currentY(el);
    gesture!.y = e.clientY;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone.
    }
  }

  function onPointerDown(e: PointerEvent) {
    const el = opts.sheet.value;
    if (!el || leaving || gesture || e.button !== 0) return;
    if (opts.ignore && (e.target as Element).closest(opts.ignore)) return;
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, base: 0, dragging: false, samples: [] };
    // Grabbed while still sliding: take it from where it is now.
    if (settle && Math.abs(currentY(el)) > 1) begin(el, e);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onMove(e: PointerEvent) {
    const g = gesture;
    const el = opts.sheet.value;
    if (!g || e.pointerId !== g.id || !el) return;
    if (!g.dragging) {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (Math.abs(dx) > Math.abs(dy)) return cleanup(); // a sideways swipe belongs to something else
      begin(el, e);
    }
    const raw = g.base + (e.clientY - g.y);
    place(el, raw < 0 ? -rubberband(-raw, height(el)) : raw);
    g.samples.push({ t: e.timeStamp, y: raw });
    while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift();
  }

  function onUp(e: PointerEvent) {
    const g = gesture;
    const el = opts.sheet.value;
    if (!g || e.pointerId !== g.id) return;
    cleanup();
    if (!g.dragging || !el) return;
    // The press turned into a drag, so the click that follows it isn't a tap.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);

    const first = g.samples[0];
    const last = g.samples[g.samples.length - 1];
    const velocity = first && last && last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0;
    const y = currentY(el);
    if (y + project(velocity) > height(el) * 0.4 && velocity > -50) {
      releaseVelocity = velocity;
      opts.dismiss();
    } else animate(el, 0, velocity);
  }

  function cleanup() {
    gesture = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  }

  return { enter, leave, onPointerDown };
}
