import { VelocityTracker } from "./physics.js";

export interface GestureCallbacks {
  onStart: (y: number) => void;
  onMove: (y: number, deltaY: number) => void;
  onEnd: (velocity: number) => void;
  /** True while the sheet is below its highest snap point. */
  canGrow: () => boolean;
}

interface GestureState {
  active: boolean;
  dragging: boolean;
  startY: number;
  currentY: number;
  directionLocked: boolean;
  lockedAxis: "x" | "y" | null;
  startX: number;
  currentX: number;
  scrolling: boolean;
  scrollTarget: HTMLElement | null;
}

/** What a move turned out to be. */
type Move = "pending" | "drag" | "scroll";

const DIRECTION_LOCK_THRESHOLD = 6;
const SCROLL_LOCK_THRESHOLD = 3;

function findScrollableAncestor(
  target: EventTarget | null,
  sheetEl: HTMLElement,
): HTMLElement | null {
  let el = target as HTMLElement | null;
  while (el && el !== sheetEl) {
    if (el.scrollHeight > el.clientHeight) {
      const style = getComputedStyle(el);
      const overflowY = style.overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

/*
 * Touch and mouse take different paths.
 *
 * Touch: the browser owns scrolling. With pointer events it claims a vertical
 * swipe over scrollable content (touch-action: pan-y) and sends pointercancel,
 * so the sheet could never be dragged from its content. Touch events let us
 * decide first: a non-passive touchmove that calls preventDefault() before
 * the browser starts scrolling keeps the gesture for the sheet.
 *
 * Mouse and pen: nothing scrolls on drag, so pointer events with pointer
 * capture once a drag starts (capturing earlier retargets the click).
 */
export function attachGestures(
  sheetEl: HTMLElement,
  handleEl: HTMLElement | null,
  handleOnly: boolean,
  callbacks: GestureCallbacks,
): () => void {
  const tracker = new VelocityTracker();
  const state: GestureState = {
    active: false,
    dragging: false,
    startY: 0,
    currentY: 0,
    directionLocked: false,
    lockedAxis: null,
    startX: 0,
    currentX: 0,
    scrolling: false,
    scrollTarget: null,
  };

  /** Start tracking a gesture. False when this target doesn't drag. */
  function begin(x: number, y: number, target: EventTarget | null): boolean {
    const isHandle = handleEl?.contains(target as Node) ?? false;
    if (handleOnly && !isHandle) return false;

    state.active = true;
    state.dragging = false;
    state.startY = y;
    state.currentY = y;
    state.startX = x;
    state.currentX = x;
    state.directionLocked = false;
    state.lockedAxis = null;
    state.scrolling = false;
    state.scrollTarget = isHandle ? null : findScrollableAncestor(target, sheetEl);

    tracker.reset();
    tracker.add(y);
    return true;
  }

  function move(x: number, y: number): Move {
    if (!state.active || state.scrolling) return "scroll";

    state.currentY = y;
    state.currentX = x;

    const dx = Math.abs(state.currentX - state.startX);
    const dy = Math.abs(state.currentY - state.startY);
    const deltaY = state.currentY - state.startY;

    if (!state.directionLocked) {
      if (dx > DIRECTION_LOCK_THRESHOLD || dy > DIRECTION_LOCK_THRESHOLD) {
        state.directionLocked = true;
        state.lockedAxis = dy >= dx ? "y" : "x";
      }
      if (dy < SCROLL_LOCK_THRESHOLD && state.lockedAxis !== "x") return "pending";
    }

    // Sideways: leave it to whatever scrolls sideways inside the sheet.
    if (state.lockedAxis === "x") {
      state.scrolling = true;
      return "scroll";
    }

    // Over scrollable content, decided once: the sheet moves when the content
    // is at its top and pulled down, or when the sheet can still grow and is
    // pushed up (it opens all the way before the content scrolls). Otherwise
    // the content scrolls.
    if (state.scrollTarget && !state.dragging) {
      const atTop = state.scrollTarget.scrollTop <= 0;
      const pullingDown = deltaY > 0;
      const sheetMoves = pullingDown ? atTop : callbacks.canGrow();
      if (!sheetMoves) {
        state.scrolling = true;
        return "scroll";
      }
    }

    if (!state.dragging) {
      state.dragging = true;
      callbacks.onStart(state.startY);
    }

    tracker.add(y);
    callbacks.onMove(state.currentY, deltaY);
    return "drag";
  }

  function end(cancelled: boolean) {
    if (!state.active) return;
    state.active = false;
    if (!state.dragging) return;
    state.dragging = false;
    callbacks.onEnd(cancelled ? 0 : tracker.getVelocity());
  }

  // --- Touch ---

  let touchId: number | null = null;

  const findTouch = (list: TouchList) => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === touchId) return list[i];
    }
    return null;
  };

  function onTouchStart(e: TouchEvent) {
    // A second finger: hand the gesture back (pinch-zoom, etc).
    if (touchId !== null) {
      end(true);
      touchId = null;
      return;
    }
    const t = e.changedTouches[0];
    if (!t || !begin(t.clientX, t.clientY, e.target)) return;
    touchId = t.identifier;
  }

  function onTouchMove(e: TouchEvent) {
    if (touchId === null) return;
    const t = findTouch(e.changedTouches);
    if (!t) return;
    const result = move(t.clientX, t.clientY);
    if (result === "drag" && e.cancelable) e.preventDefault();
  }

  function onTouchEnd(e: TouchEvent) {
    if (touchId === null || !findTouch(e.changedTouches)) return;
    touchId = null;
    end(e.type === "touchcancel");
  }

  // --- Mouse and pen ---

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "touch" || e.button !== 0) return;
    if (!begin(e.clientX, e.clientY, e.target)) return;
    // No pointer capture yet: capturing here would retarget the click to the
    // sheet, so buttons and links inside it would never get their tap. Until
    // a drag starts, the pointer is followed on the window, since it can leave
    // the sheet (up past a handle near its top edge) before the drag threshold.
    // Once a drag starts it's captured, so a drag never clicks.
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function stopFollowing() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
    const wasDragging = state.dragging;
    if (move(e.clientX, e.clientY) !== "drag") return;
    if (!wasDragging) sheetEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerUp(e: PointerEvent) {
    stopFollowing();
    if (sheetEl.hasPointerCapture(e.pointerId)) sheetEl.releasePointerCapture(e.pointerId);
    end(e.type === "pointercancel");
  }

  const onContextMenu = (e: Event) => {
    if (state.active) e.preventDefault();
  };

  sheetEl.addEventListener("touchstart", onTouchStart, { passive: true });
  sheetEl.addEventListener("touchmove", onTouchMove, { passive: false });
  sheetEl.addEventListener("touchend", onTouchEnd);
  sheetEl.addEventListener("touchcancel", onTouchEnd);
  sheetEl.addEventListener("pointerdown", onPointerDown);
  sheetEl.addEventListener("contextmenu", onContextMenu);

  return () => {
    sheetEl.removeEventListener("touchstart", onTouchStart);
    sheetEl.removeEventListener("touchmove", onTouchMove);
    sheetEl.removeEventListener("touchend", onTouchEnd);
    sheetEl.removeEventListener("touchcancel", onTouchEnd);
    sheetEl.removeEventListener("pointerdown", onPointerDown);
    stopFollowing();
    sheetEl.removeEventListener("contextmenu", onContextMenu);
  };
}
