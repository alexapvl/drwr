import {
  animateSpring,
  resolveSnapPoint,
  type SpringConfig,
} from "./physics.js";
import { attachGestures } from "./gestures.js";
import {
  applyAriaAttributes,
  removeAriaAttributes,
  createFocusTrap,
  lockScroll,
} from "./accessibility.js";

export type SheetAlign = "center" | "left" | "right";
export type DragMode = "handle" | "sheet" | "none";

export interface SheetOptions {
  snapPoints?: number[];
  defaultSnap?: number;
  overlay?: boolean;
  dragHandle?: boolean;
  damping?: number;
  stiffness?: number;
  mass?: number;
  closeThreshold?: number;
  /** Top padding in px for the maximum open height. Default: 40. */
  topPadding?: number;
  /** Width as a percentage of the viewport (0–100). Default: 60 on desktop, 100 on mobile. */
  width?: number;
  /** Horizontal alignment. Default: "center". */
  align?: SheetAlign;
  /** Minimum side padding in px. Default: 0. */
  sidePadding?: number;
  /** Max width in px. 0 = no max. Default: 0. */
  maxWidth?: number;
  /** Which part of the sheet initiates drag. Default: "sheet". */
  dragMode?: DragMode;
  /** Accessible label for the sheet dialog. Default: "Sheet". */
  ariaLabel?: string;
  /** ID of the element labelling the sheet. Overrides ariaLabel when set. */
  ariaLabelledBy?: string;
  /** Close on Escape key. Default: true. */
  closeOnEscape?: boolean;
  /** Close on overlay click. Default: true. */
  closeOnOverlayClick?: boolean;
  /** Trap focus inside the sheet. Default: true. */
  trapFocus?: boolean;
  /** Set aria-modal. Default: true. */
  modal?: boolean;
  /** Honour prefers-reduced-motion by skipping spring animation. Default: true. */
  reducedMotion?: boolean;
  /** Called when open animation completes. */
  onOpen?: () => void;
  /** Called when close animation completes. */
  onClose?: () => void;
  onSnap?: (point: number) => void;
}

/** Subset of SheetOptions that can be changed at runtime via setOptions(). */
export type MutableSheetOptions = Pick<
  SheetOptions,
  | "snapPoints"
  | "damping"
  | "stiffness"
  | "mass"
  | "closeThreshold"
  | "topPadding"
  | "width"
  | "align"
  | "sidePadding"
  | "maxWidth"
  | "ariaLabel"
  | "ariaLabelledBy"
  | "closeOnEscape"
  | "closeOnOverlayClick"
  | "modal"
  | "reducedMotion"
  | "onOpen"
  | "onClose"
  | "onSnap"
>;

type SheetState = "closed" | "open" | "dragging" | "animating";

/** Logarithmic resistance like vaul: soft, organic feel past bounds. */
function dampen(v: number): number {
  return 8 * (Math.log(v + 1) - 2);
}

export class Sheet {
  private container: HTMLElement;
  private options: Required<SheetOptions>;

  private wrapperEl!: HTMLElement;
  private overlayEl: HTMLElement | null = null;
  private handleEl: HTMLElement | null = null;
  private contentEl!: HTMLElement;

  private state: SheetState = "closed";
  private currentSnap = 0;
  // Current height of the sheet in pixels (0 = closed, positive = visible)
  private currentH = 0;
  private dragStartH = 0;

  private cancelAnimation: (() => void) | null = null;
  private cleanupGestures: (() => void) | null = null;
  private cleanupFocusTrap: (() => void) | null = null;
  private unlockScroll: (() => void) | null = null;
  private onPageShow: ((e: PageTransitionEvent) => void) | null = null;
  private onResize: (() => void) | null = null;
  private naturalContentH = 0;
  private destroyed = false;

  private static sanitizeSnapPoints(raw: number[]): number[] {
    const valid = raw.filter((n) => Number.isFinite(n) && n >= 0 && n <= 1);
    const deduped = [...new Set(valid)].sort((a, b) => a - b);
    if (deduped.length === 0) return [0, 1];
    if (!deduped.includes(0)) deduped.unshift(0);
    return deduped;
  }

  private prefersReducedMotion(): boolean {
    return (
      this.options.reducedMotion &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  constructor(container: HTMLElement, options: SheetOptions = {}) {
    this.container = container;
    const snaps = Sheet.sanitizeSnapPoints(options.snapPoints ?? [0, 1]);
    this.options = {
      snapPoints: snaps,
      defaultSnap: options.defaultSnap ?? 0,
      overlay: options.overlay ?? true,
      dragHandle: options.dragHandle ?? true,
      damping: options.damping ?? 30,
      stiffness: options.stiffness ?? 200,
      mass: options.mass ?? 1,
      closeThreshold: options.closeThreshold ?? 0.2,
      topPadding: options.topPadding ?? 40,
      width: options.width ?? (window.innerWidth >= 768 ? 60 : 100),
      align: options.align ?? "center",
      sidePadding: options.sidePadding ?? 0,
      maxWidth: options.maxWidth ?? 0,
      dragMode: options.dragMode ?? "sheet",
      ariaLabel: options.ariaLabel ?? "Sheet",
      ariaLabelledBy: options.ariaLabelledBy ?? "",
      closeOnEscape: options.closeOnEscape ?? true,
      closeOnOverlayClick: options.closeOnOverlayClick ?? true,
      trapFocus: options.trapFocus ?? true,
      modal: options.modal ?? true,
      reducedMotion: options.reducedMotion ?? true,
      onOpen: options.onOpen ?? (() => {}),
      onClose: options.onClose ?? (() => {}),
      onSnap: options.onSnap ?? (() => {}),
    };

    this.buildDOM();
    this.container.removeAttribute("hidden");
    this.naturalContentH = this.getContentHeight();
    this.bindGestures();

    const defaultSnap = this.options.defaultSnap;
    if (defaultSnap > 0 && this.options.snapPoints.includes(defaultSnap)) {
      this.currentH = this.snapToPixels(defaultSnap);
      this.render(this.currentH);
      this.state = "open";
      this.currentSnap = defaultSnap;
      document.addEventListener("keydown", this.onKeyDown);
      if (!this.unlockScroll) this.unlockScroll = lockScroll();
      if (this.options.trapFocus && !this.cleanupFocusTrap) {
        this.cleanupFocusTrap = createFocusTrap(this.wrapperEl);
      }
      queueMicrotask(() => {
        if (this.destroyed) return;
        this.options.onOpen();
      });
    } else {
      this.currentH = 0;
      this.render(0);
    }
    this.onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && this.state !== "closed") {
        this.resetToClosedState();
      }
    };
    window.addEventListener("pageshow", this.onPageShow);

    this.onResize = () => {
      this.applyLayout();
      this.naturalContentH = this.getContentHeight();
      if (this.state !== "closed" && this.currentSnap > 0) {
        this.currentH = this.snapToPixels(this.currentSnap);
        this.render(this.currentH);
      }
    };
    window.addEventListener("resize", this.onResize);
  }

  // --- Snap point conversion ---

  private getContentHeight(): number {
    return this.contentEl.scrollHeight + (this.handleEl?.offsetHeight ?? 0);
  }

  private maxSheetH(): number {
    return window.innerHeight - this.options.topPadding;
  }

  /** Convert a normalized snap point (0–1) to available viewport height. */
  private snapToPixels(snap: number): number {
    if (snap <= 0) return 0;
    const maxH = this.maxSheetH();
    return Math.min(snap, 1) * maxH;
  }

  /** Get all snap points as pixel heights, sorted ascending. */
  private snapPixels(): number[] {
    return this.options.snapPoints
      .map((s) => this.snapToPixels(s))
      .sort((a, b) => a - b);
  }

  /** Find the normalized snap point closest to a pixel height. */
  private pixelsToSnap(px: number): number {
    const snaps = this.options.snapPoints;
    let closest = snaps[0];
    let closestDist = Math.abs(px - this.snapToPixels(snaps[0]));
    for (let i = 1; i < snaps.length; i++) {
      const dist = Math.abs(px - this.snapToPixels(snaps[i]));
      if (dist < closestDist) {
        closest = snaps[i];
        closestDist = dist;
      }
    }
    return closest;
  }

  // --- DOM ---

  private applyLayout() {
    const { width, align, sidePadding, maxWidth } = this.options;
    const el = this.wrapperEl;

    const vw = window.innerWidth;
    const clampedWidth = Math.max(10, Math.min(100, width));
    const pad = Math.max(0, Math.min(sidePadding, vw / 2 - 10));

    let sheetW = Math.max(20, Math.min(vw * (clampedWidth / 100), vw - pad * 2));
    if (maxWidth > 0) sheetW = Math.min(sheetW, maxWidth);

    let left: number;
    if (align === "left") {
      left = pad;
    } else if (align === "right") {
      left = vw - sheetW - pad;
    } else {
      left = (vw - sheetW) / 2;
    }

    el.style.left = `${left}px`;
    el.style.right = "auto";
    el.style.width = `${sheetW}px`;
    el.style.margin = "0";
  }

  private buildDOM() {
    this.wrapperEl = document.createElement("div");
    this.wrapperEl.className = "drwr-sheet";
    this.wrapperEl.setAttribute("tabindex", "-1");

    if (this.options.dragHandle) {
      this.handleEl = document.createElement("div");
      this.handleEl.className = "drwr-handle";
      this.wrapperEl.appendChild(this.handleEl);
    }

    this.contentEl = document.createElement("div");
    this.contentEl.className = "drwr-content";

    while (this.container.firstChild) {
      this.contentEl.appendChild(this.container.firstChild);
    }
    this.wrapperEl.appendChild(this.contentEl);
    this.container.appendChild(this.wrapperEl);

    if (this.options.overlay) {
      this.overlayEl = document.createElement("div");
      this.overlayEl.className = "drwr-overlay";
      this.overlayEl.addEventListener("click", () => {
        if (this.options.closeOnOverlayClick) this.close();
      });
      this.container.insertBefore(this.overlayEl, this.wrapperEl);
    }

    applyAriaAttributes(this.wrapperEl, this.overlayEl, {
      ariaLabel: this.options.ariaLabel,
      ariaLabelledBy: this.options.ariaLabelledBy,
      modal: this.options.modal,
    });
    this.applyLayout();
  }

  // --- Gestures ---

  private bindGestures() {
    if (this.options.dragMode === "none") return;
    this.cleanupGestures = attachGestures(
      this.wrapperEl,
      this.handleEl,
      this.options.dragMode === "handle",
      {
        onStart: () => {
          this.cancelCurrentAnimation();
          this.state = "dragging";
          this.dragStartH = this.currentH;
          this.wrapperEl.setAttribute("data-dragging", "true");
        },
        onMove: (_y, deltaY) => {
          // deltaY positive = finger moved down = sheet should shrink
          let newH = this.dragStartH - deltaY;

          const snaps = this.snapPixels();
          const maxH = snaps[snaps.length - 1];
          const minH = snaps[0];

          if (newH > maxH) {
            newH = maxH;
          } else if (newH < minH) {
            const overflow = minH - newH;
            newH = minH - Math.max(0, dampen(overflow));
          }

          this.currentH = newH;
          this.render(newH);
        },
        onEnd: (velocityPx) => {
          this.wrapperEl.setAttribute("data-dragging", "false");
          const velocityH = -velocityPx;
          this.state = "animating";

          const snaps = this.snapPixels();
          let targetH = resolveSnapPoint(this.currentH, velocityH, snaps, 400);

          // closeThreshold: if the sheet is dragged below (lowestNonZeroSnap * threshold), close it
          const nonZeroSnaps = snaps.filter((s) => s > 0);
          if (nonZeroSnaps.length > 0) {
            const lowestNonZero = nonZeroSnaps[0];
            if (this.currentH < lowestNonZero * this.options.closeThreshold) {
              targetH = 0;
            }
          }

          this.animateToH(targetH, velocityH);
        },
      },
    );
  }

  // --- Animation ---

  private cancelCurrentAnimation() {
    if (this.cancelAnimation) {
      this.cancelAnimation();
      this.cancelAnimation = null;
    }
  }

  private animateToH(targetH: number, initialVelocity = 0) {
    const wasOpen = this.state === "open" || this.state === "dragging";
    this.cancelCurrentAnimation();
    this.state = "animating";
    const onDone = () => {
      this.currentH = targetH;
      this.render(targetH);
      this.cancelAnimation = null;

      const snap = this.pixelsToSnap(targetH);
      this.currentSnap = snap;

      if (targetH <= 0.5) {
        this.onClosed();
      } else {
        this.state = "open";
        if (!wasOpen) this.options.onOpen();
        this.options.onSnap(snap);
      }
    };

    if (this.prefersReducedMotion()) {
      onDone();
      return;
    }

    const springConfig: Partial<SpringConfig> = {
      damping: this.options.damping,
      stiffness: this.options.stiffness,
      mass: this.options.mass,
    };

    this.cancelAnimation = animateSpring(
      this.currentH,
      targetH,
      initialVelocity,
      springConfig,
      (value) => {
        this.currentH = value;
        this.render(value);
      },
      onDone,
    );
  }

  // --- Rendering ---

  private render(h: number) {
    const viewportH = window.innerHeight;
    const visibleH = Math.max(0, h);
    const translateY = viewportH - visibleH;

    this.wrapperEl.style.visibility = visibleH > 0.5 ? "visible" : "hidden";

    this.wrapperEl.style.transform = `translate3d(0, ${translateY}px, 0)`;
    this.wrapperEl.style.height = visibleH > 0.5 ? `${visibleH}px` : "";

    if (this.overlayEl) {
      const snaps = this.snapPixels();
      const maxH = snaps[snaps.length - 1];
      const opacity = Math.max(0, Math.min(1, visibleH / (maxH * 0.3)));
      this.overlayEl.style.opacity = String(opacity);
      this.overlayEl.setAttribute("data-visible", visibleH > 1 ? "true" : "false");
    }
  }

  // --- State changes ---

  /** Shared cleanup: visually close and tear down locks/traps. Does NOT fire callbacks. */
  private resetToClosedState() {
    this.cancelCurrentAnimation();
    this.currentH = 0;
    this.currentSnap = 0;
    this.render(0);
    this.state = "closed";

    if (this.overlayEl) {
      this.overlayEl.style.opacity = "0";
      this.overlayEl.setAttribute("data-visible", "false");
    }
    if (this.unlockScroll) {
      this.unlockScroll();
      this.unlockScroll = null;
    }
    if (this.cleanupFocusTrap) {
      this.cleanupFocusTrap();
      this.cleanupFocusTrap = null;
    }
    document.removeEventListener("keydown", this.onKeyDown);
  }

  private onClosed() {
    this.resetToClosedState();
    this.options.onClose();
  }

  // --- Keyboard ---

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.state !== "closed" && this.options.closeOnEscape) {
      this.close();
    }
  };

  // --- Public API ---

  open(point?: number) {
    if (this.destroyed || this.state === "open") return;

    const sorted = [...this.options.snapPoints].sort((a, b) => a - b);
    let target: number;
    if (point !== undefined) {
      if (!sorted.includes(point) || point === 0) {
        console.warn(`[drwr] snap point ${point} not valid for open()`);
        return;
      }
      target = point;
    } else {
      target = sorted[sorted.length - 1];
    }

    document.addEventListener("keydown", this.onKeyDown);
    this.animateToH(this.snapToPixels(target));
    if (!this.unlockScroll) this.unlockScroll = lockScroll();
    if (this.options.trapFocus && !this.cleanupFocusTrap) {
      this.cleanupFocusTrap = createFocusTrap(this.wrapperEl);
    }
  }

  close() {
    if (this.destroyed || this.state === "closed") return;
    document.removeEventListener("keydown", this.onKeyDown);
    this.animateToH(0);
  }

  snapTo(point: number) {
    if (this.destroyed) return;
    if (!this.options.snapPoints.includes(point)) {
      console.warn(`[drwr] snap point ${point} not in snapPoints`);
      return;
    }
    if (point === 0) {
      this.close();
    } else {
      if (this.state === "closed") {
        document.addEventListener("keydown", this.onKeyDown);
        if (!this.unlockScroll) this.unlockScroll = lockScroll();
        if (this.options.trapFocus && !this.cleanupFocusTrap) {
          this.cleanupFocusTrap = createFocusTrap(this.wrapperEl);
        }
      }
      this.animateToH(this.snapToPixels(point));
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.cancelCurrentAnimation();
    document.removeEventListener("keydown", this.onKeyDown);

    if (this.cleanupGestures) {
      this.cleanupGestures();
      this.cleanupGestures = null;
    }
    if (this.cleanupFocusTrap) {
      this.cleanupFocusTrap();
      this.cleanupFocusTrap = null;
    }
    if (this.unlockScroll) {
      this.unlockScroll();
      this.unlockScroll = null;
    }
    if (this.onPageShow) {
      window.removeEventListener("pageshow", this.onPageShow);
      this.onPageShow = null;
    }
    if (this.onResize) {
      window.removeEventListener("resize", this.onResize);
      this.onResize = null;
    }

    removeAriaAttributes(this.wrapperEl, this.overlayEl);

    while (this.contentEl.firstChild) {
      this.container.appendChild(this.contentEl.firstChild);
    }

    this.wrapperEl.remove();
    this.overlayEl?.remove();

  }

  setSnapPoints(points: number[]) {
    if (this.destroyed) return;
    this.options.snapPoints = Sheet.sanitizeSnapPoints(points);

    if (this.state !== "closed" && this.currentSnap > 0) {
      if (!this.options.snapPoints.includes(this.currentSnap)) {
        const nearest = this.pixelsToSnap(this.currentH);
        this.animateToH(this.snapToPixels(nearest));
      }
    }
  }

  /** Re-measure content height and recompute current position. Call after dynamic content changes. */
  refresh() {
    if (this.destroyed) return;
    this.naturalContentH = this.getContentHeight();
    if (this.state !== "closed" && this.currentSnap > 0) {
      this.currentH = this.snapToPixels(this.currentSnap);
      this.render(this.currentH);
    }
  }

  setOptions(opts: MutableSheetOptions) {
    if (this.destroyed) return;
    if (opts.snapPoints !== undefined) this.options.snapPoints = Sheet.sanitizeSnapPoints(opts.snapPoints);
    if (opts.damping !== undefined) this.options.damping = opts.damping;
    if (opts.stiffness !== undefined) this.options.stiffness = opts.stiffness;
    if (opts.mass !== undefined) this.options.mass = opts.mass;
    if (opts.closeThreshold !== undefined) this.options.closeThreshold = opts.closeThreshold;
    if (opts.topPadding !== undefined) this.options.topPadding = opts.topPadding;
    if (opts.closeOnEscape !== undefined) this.options.closeOnEscape = opts.closeOnEscape;
    if (opts.closeOnOverlayClick !== undefined) this.options.closeOnOverlayClick = opts.closeOnOverlayClick;
    if (opts.ariaLabel !== undefined) this.options.ariaLabel = opts.ariaLabel;
    if (opts.ariaLabelledBy !== undefined) this.options.ariaLabelledBy = opts.ariaLabelledBy;
    if (opts.modal !== undefined) this.options.modal = opts.modal;
    if (opts.maxWidth !== undefined) this.options.maxWidth = opts.maxWidth;
    if (opts.reducedMotion !== undefined) this.options.reducedMotion = opts.reducedMotion;
    if (opts.onOpen !== undefined) this.options.onOpen = opts.onOpen;
    if (opts.onClose !== undefined) this.options.onClose = opts.onClose;
    if (opts.onSnap !== undefined) this.options.onSnap = opts.onSnap;

    if (opts.ariaLabel !== undefined || opts.ariaLabelledBy !== undefined || opts.modal !== undefined) {
      applyAriaAttributes(this.wrapperEl, this.overlayEl, {
        ariaLabel: this.options.ariaLabel,
        ariaLabelledBy: this.options.ariaLabelledBy,
        modal: this.options.modal,
      });
    }
    if (opts.width !== undefined || opts.align !== undefined || opts.sidePadding !== undefined || opts.maxWidth !== undefined) {
      if (opts.width !== undefined) this.options.width = opts.width;
      if (opts.align !== undefined) this.options.align = opts.align;
      if (opts.sidePadding !== undefined) this.options.sidePadding = opts.sidePadding;
      this.applyLayout();
    }

    // Recompute position when size-affecting options changed
    const sizeChanged = opts.topPadding !== undefined || opts.snapPoints !== undefined;
    if (sizeChanged && this.state !== "closed" && this.currentSnap > 0) {
      if (opts.snapPoints !== undefined && !this.options.snapPoints.includes(this.currentSnap)) {
        const nearest = this.pixelsToSnap(this.currentH);
        this.animateToH(this.snapToPixels(nearest));
      } else {
        this.currentH = this.snapToPixels(this.currentSnap);
        this.render(this.currentH);
      }
    }
  }

  setLayout(opts: { width?: number; align?: SheetAlign; sidePadding?: number }) {
    if (this.destroyed) return;
    if (opts.width !== undefined) this.options.width = opts.width;
    if (opts.align !== undefined) this.options.align = opts.align;
    if (opts.sidePadding !== undefined) this.options.sidePadding = opts.sidePadding;
    this.applyLayout();
  }

  get isOpen(): boolean {
    return this.state !== "closed";
  }

  get currentSnapPoint(): number {
    return this.currentSnap;
  }
}
