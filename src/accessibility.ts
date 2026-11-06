const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Creates a focus trap within the given element.
 * Returns a cleanup function.
 */
export function createFocusTrap(container: HTMLElement): () => void {
  let previousFocus: HTMLElement | null = null;

  function getFocusable(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Tab") return;

    const focusable = getFocusable();
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first || !container.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !container.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function activate() {
    previousFocus = document.activeElement as HTMLElement | null;
    container.addEventListener("keydown", onKeyDown);

    // Focus first focusable element or the container itself
    requestAnimationFrame(() => {
      const focusable = getFocusable();
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    });
  }

  function deactivate() {
    container.removeEventListener("keydown", onKeyDown);
    previousFocus?.focus();
    previousFocus = null;
  }

  activate();

  return deactivate;
}

export interface AriaOptions {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  modal?: boolean;
}

/**
 * Applies ARIA attributes for a modal dialog.
 */
export function applyAriaAttributes(
  sheetEl: HTMLElement,
  overlayEl: HTMLElement | null,
  opts: AriaOptions = {},
) {
  sheetEl.setAttribute("role", "dialog");
  sheetEl.setAttribute("aria-modal", opts.modal !== false ? "true" : "false");

  if (opts.ariaLabelledBy) {
    sheetEl.setAttribute("aria-labelledby", opts.ariaLabelledBy);
    sheetEl.removeAttribute("aria-label");
  } else {
    sheetEl.setAttribute("aria-label", opts.ariaLabel || "Sheet");
    sheetEl.removeAttribute("aria-labelledby");
  }

  if (overlayEl) {
    overlayEl.setAttribute("aria-hidden", "true");
  }
}

/**
 * Removes ARIA attributes when the sheet is destroyed.
 */
export function removeAriaAttributes(
  sheetEl: HTMLElement,
  overlayEl: HTMLElement | null,
) {
  sheetEl.removeAttribute("role");
  sheetEl.removeAttribute("aria-modal");
  if (overlayEl) {
    overlayEl.removeAttribute("aria-hidden");
  }
}

/* one lock for the page, however many sheets hold it. each sheet used to
   save and restore the page's overflow on its own, so when one sheet opened
   while another was still closing (switching from one to the next), the
   second saved the first's "hidden" as the page's own and put it back when
   it closed: the page stayed locked with no sheet open. now the first lock
   saves the page as it was, and the last unlock puts it back. */
let holders = 0;
let saved: { body: string; html: string } | null = null;

// On iOS Safari, overflow:hidden on body/html doesn't fully prevent
// scroll on its own. We block touchmove on the document as a fallback.
function preventTouch(e: TouchEvent) {
  // Allow scrolling inside the sheet content
  let el = e.target as HTMLElement | null;
  while (el) {
    if (el.classList?.contains("drwr-content")) return;
    el = el.parentElement;
  }
  e.preventDefault();
}

/**
 * iOS-safe scroll lock. Prevents background scrolling without position:fixed
 * to avoid the iOS Safari viewport jump when the address bar is visible.
 * Counted: the page unlocks when the last sheet holding it lets go.
 */
export function lockScroll(): () => void {
  const body = document.body;
  const html = document.documentElement;

  if (holders++ === 0) {
    saved = { body: body.style.overflow, html: html.style.overflow };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    document.addEventListener("touchmove", preventTouch, { passive: false });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holders > 0) return;
    holders = 0;
    body.style.overflow = saved?.body ?? "";
    html.style.overflow = saved?.html ?? "";
    saved = null;
    document.removeEventListener("touchmove", preventTouch);
  };
}
