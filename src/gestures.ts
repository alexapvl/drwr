import { VelocityTracker } from "./physics.js";

export interface GestureCallbacks {
  onStart: (y: number) => void;
  onMove: (y: number, deltaY: number) => void;
  onEnd: (velocity: number) => void;
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

  function onPointerDown(e: PointerEvent) {
    const isHandle = handleEl?.contains(e.target as Node);
    if (handleOnly && !isHandle) return;
    const scrollable = isHandle
      ? null
      : findScrollableAncestor(e.target, sheetEl);

    state.active = true;
    state.dragging = false;
    state.startY = e.clientY;
    state.currentY = e.clientY;
    state.startX = e.clientX;
    state.currentX = e.clientX;
    state.directionLocked = false;
    state.lockedAxis = null;
    state.scrolling = false;
    state.scrollTarget = scrollable;

    tracker.reset();
    tracker.add(e.clientY);

    sheetEl.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!state.active || state.scrolling) return;

    state.currentY = e.clientY;
    state.currentX = e.clientX;

    const dx = Math.abs(state.currentX - state.startX);
    const dy = Math.abs(state.currentY - state.startY);
    const deltaY = state.currentY - state.startY;

    // Direction locking
    if (!state.directionLocked) {
      if (dx > DIRECTION_LOCK_THRESHOLD || dy > DIRECTION_LOCK_THRESHOLD) {
        state.directionLocked = true;
        state.lockedAxis = dy >= dx ? "y" : "x";
      }
      if (dy < SCROLL_LOCK_THRESHOLD) return;
    }

    if (state.lockedAxis === "x") return;

    // Scroll vs drag disambiguation (decided once)
    if (state.scrollTarget && !state.dragging) {
      const st = state.scrollTarget;
      const atTop = st.scrollTop <= 0;
      const atBottom = st.scrollTop + st.clientHeight >= st.scrollHeight - 1;
      const draggingDown = deltaY > 0;

      if (draggingDown && atTop) {
        // At top, pulling down → drag sheet
      } else if (!draggingDown && atBottom) {
        // At bottom, pulling up → drag sheet
      } else {
        // Let the content scroll
        state.scrolling = true;
        return;
      }
    }

    // Begin drag on first qualifying move
    if (!state.dragging) {
      state.dragging = true;
      callbacks.onStart(state.startY);
    }

    e.preventDefault();
    tracker.add(e.clientY);
    callbacks.onMove(state.currentY, deltaY);
  }

  function onPointerUp(e: PointerEvent) {
    if (!state.active) return;
    state.active = false;
    sheetEl.releasePointerCapture(e.pointerId);

    if (!state.dragging) return;
    state.dragging = false;

    const velocity = tracker.getVelocity();
    callbacks.onEnd(velocity);
  }

  function onPointerCancel(e: PointerEvent) {
    if (!state.active) return;
    state.active = false;
    sheetEl.releasePointerCapture(e.pointerId);

    if (!state.dragging) return;
    state.dragging = false;
    callbacks.onEnd(0);
  }

  sheetEl.addEventListener("pointerdown", onPointerDown);
  sheetEl.addEventListener("pointermove", onPointerMove);
  sheetEl.addEventListener("pointerup", onPointerUp);
  sheetEl.addEventListener("pointercancel", onPointerCancel);

  const onContextMenu = (e: Event) => {
    if (state.active) e.preventDefault();
  };
  sheetEl.addEventListener("contextmenu", onContextMenu);

  return () => {
    sheetEl.removeEventListener("pointerdown", onPointerDown);
    sheetEl.removeEventListener("pointermove", onPointerMove);
    sheetEl.removeEventListener("pointerup", onPointerUp);
    sheetEl.removeEventListener("pointercancel", onPointerCancel);
    sheetEl.removeEventListener("contextmenu", onContextMenu);
  };
}
