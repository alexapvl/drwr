---
name: drwr-web
description: >-
  Wire @alexapvl/drwr into a webpage as a lazy-loaded mobile bottom sheet,
  usually hamburger navigation. Use when adding drwr, a mobile drawer, bottom
  sheet, or sheet-based nav to a marketing site or app.
---

# drwr on a webpage

Package: [`@alexapvl/drwr`](https://github.com/alexapvl/drwr). Vanilla `Sheet` + CSS. No framework required.

Do not load drwr on desktop. Do not put `new Sheet()` in the critical path. Theme with CSS variables, not a fork of the library.

## Architecture

Four pieces. Keep them separate.

| Piece | Role |
|---|---|
| Trigger | Hamburger (or other control) in the header. Owns `aria-expanded` / `aria-label`. |
| Host | Empty container in the layout. Children are sheet content. Starts `hidden`. |
| Bootstrap | Tiny inline/module script. Dynamic-imports the sheet module on first open. |
| Sheet module | Imports `@alexapvl/drwr` + `style.css`. Creates, opens, closes, destroys. |

Markup contract: pass the **host element** to `new Sheet(host, options)`. Drwr unwraps its children into `.drwr-content`, adds `.drwr-sheet` + optional `.drwr-overlay` / `.drwr-handle`, and removes `hidden`.

```html
<button type="button" id="hamburger-btn"
  aria-label="Open menu" aria-expanded="false" aria-controls="sheet-host">
</button>

<div id="sheet-host" hidden>
  <!-- nav links, actions, whatever the sheet should show -->
</div>
```

Mount the host once in the page chrome (layout), not per-page, so one sheet serves the whole site.

## Install

```bash
pnpm add @alexapvl/drwr
```

Import CSS **inside the lazy sheet module**, not the global entry:

```ts
import "@alexapvl/drwr/style.css";
import { Sheet } from "@alexapvl/drwr";
```

Astro/Vite may still extract that CSS into the page bundle. That is acceptable for this small file. Do not also `@import` it from global CSS.

## Lazy bootstrap

Gate on a mobile media query. First hamburger click loads the module and opens. Crossing the breakpoint destroys the sheet so desktop never keeps a live instance.

```ts
const MOBILE_QUERY = "(max-width: 819px)"; // match the CSS that shows the hamburger

hamburgerBtn.addEventListener("click", (event) => {
  if (alreadyBootstrapped) return;
  event.stopImmediatePropagation();
  void import("./sheet-module").then(({ init }) => init({ open: true }));
}, { capture: true });

matchMedia(MOBILE_QUERY).addEventListener("change", async () => {
  if (!alreadyBootstrapped) return;
  const { init, destroy } = await import("./sheet-module");
  if (!matchMedia(MOBILE_QUERY).matches) {
    destroy();
    alreadyBootstrapped = false;
    return;
  }
  init();
});
```

`stopImmediatePropagation` on the first click prevents the not-yet-bound module handler from missing that tap.

`init()` must no-op (or destroy) when the query does not match.

## Sheet options (recommended defaults)

```ts
const sheet = new Sheet(host, {
  snapPoints: [0, 1],
  topPadding: 40,
  closeThreshold: 0.2,
  dragHandle: true,
  width: 95,
  sidePadding: 16,
  trapFocus: false,       // hamburger stays in the header, outside the sheet
  ariaLabel: "navigation",
  onClose: () => syncTrigger(false),
});
```

Then size the open snap to **content**, not the viewport. Drwr snap points are fractions of `window.innerHeight - topPadding`. A hug-content menu:

```ts
const maxH = Math.max(0, window.innerHeight - topPadding);
const contentH =
  host.querySelector(".drwr-content")?.scrollHeight ?? 0
  + (host.querySelector(".drwr-handle")?.getBoundingClientRect().height ?? 0);
const contentSnap = Math.min(1, Math.max(0.15, contentH / maxH));
sheet.setSnapPoints([0, contentSnap]);
```

Call `sheet.refresh()` + recompute snaps after content changes.

`trapFocus: false` is required when the trigger stays focusable above the sheet. If the trigger lives **inside** the sheet, leave the default (`true`).

## Trigger state

`onOpen` / `onClose` fire when the **spring finishes**, not when the user commits. For a hamburger that morphs to X:

1. Opening: set expanded + `sheet.open()` immediately.
2. Closing via button: flip trigger first, then `sheet.close()`.
3. Overlay click and Escape: flip trigger immediately (library also closes).
4. Drag-to-close: predict close on `pointerup` while `data-dragging="true"`, then flip the trigger **before** `onClose`.

Keep a `html[data-sheet-open]` flag so the header can sit above the sheet during open **and** during the close animation. When flipping closed early, pass a "keep header pinned" flag and only drop the attribute in `onClose`.

For drag-to-close, track pointer velocity during the drag and, on release, predict whether the sheet will settle closed (position past `closeThreshold`, or a fast downward fling). Flip the trigger as soon as that prediction says closed. Skip this for a sheet with no persistent trigger chrome.

Also update `aria-expanded` and `aria-label` (`Open menu` / `Close menu`) in the same sync function.

## Hamburger to X icon

This is the part that keeps going wrong: bars rotating around the icon's center while they move end up off-center and draw a ">" halfway. Two rules:

1. **Each bar turns around its own center.** HTML spans: stack them absolutely on the same center line, offset with `translateY`, `transform-origin: center`. SVG paths: `transform-box: fill-box; transform-origin: center`. Never a shared origin such as `transform-origin: 12px 12px` with `transform-box: view-box`.
2. **Move, then turn.** Opening: bars meet on the middle line first, then rotate to ±45deg. Closing: rotate back first, then part. Use the individual `translate` and `rotate` properties so each gets its own duration and delay.

```css
/* SVG, two bars at y=9 and y=15 in a 24x24 viewBox */
.menu-btn .l1,
.menu-btn .l2 {
  transform-box: fill-box;
  transform-origin: center;
  transition: rotate 160ms var(--ease-out), translate 160ms var(--ease-out) 120ms; /* closing */
}
.menu-btn[aria-expanded="true"] .l1,
.menu-btn[aria-expanded="true"] .l2 {
  transition: translate 160ms var(--ease-out), rotate 200ms var(--ease-out) 120ms; /* opening */
}
.menu-btn[aria-expanded="true"] .l1 { translate: 0 3px;  rotate: 45deg; }
.menu-btn[aria-expanded="true"] .l2 { translate: 0 -3px; rotate: -45deg; }
.menu-btn { -webkit-tap-highlight-color: transparent; }

@media (prefers-reduced-motion: reduce) {
  .menu-btn .l1, .menu-btn .l2,
  .menu-btn[aria-expanded="true"] .l1,
  .menu-btn[aria-expanded="true"] .l2 { transition: none; }
}
```

With three bars, the middle one fades and scales out while the outer two meet. Verify it on a phone viewport by capturing frames every ~45 ms: expect `=` then `-` then `x`, and the cross centered in the button.

## Z-index stacking

Header is below the overlay by default, **above** the sheet while open so the hamburger remains tappable.

```css
:root {
  --drwr-z-index: 40;
  --z-sheet-chrome: 45; /* header while open */
}

@media (max-width: 819px) {
  #sheet-host .drwr-sheet { z-index: var(--z-sheet-chrome); }
  #sheet-host .drwr-overlay { z-index: calc(var(--z-sheet-chrome) - 1); }

  html[data-sheet-open] .site-header {
    z-index: calc(var(--z-sheet-chrome) + 1);
  }
}
```

Hide native scrollbars on `.drwr-content` when the sheet is a short nav (content should not scroll independently of the sheet drag).

## Theming

Map library tokens to the site palette on `:root`. Override handle/sheet locally if the defaults are too faint on a dark background.

```css
:root {
  --drwr-bg: var(--panel-bg);
  --drwr-radius: 18px;
  --drwr-handle-width: 36px;
  --drwr-handle-height: 4px;
  --drwr-handle-color: rgba(255, 255, 255, 0.28);
  --drwr-overlay-color: rgba(10, 18, 16, 0.55);
  --drwr-shadow: var(--panel-shadow);
  --drwr-border: 1px solid var(--panel-border);
  --drwr-z-index: 40;
}
```

Full token list: drwr README. Do not restyle by forking `style.css`.

## In-sheet links

On click: close the sheet, then navigate.

- Same-page hash: `preventDefault`, `scrollIntoView`, `history.pushState`.
- Downloads and `target="_blank"`: do not preventDefault; just close.
- Other internal URLs: close, then `location.assign`.

Honor `prefers-reduced-motion` for the scroll.

## Desktop CSS

Show the hamburger and host behavior only under the same query used in JS. Desktop uses the inline header nav. Destroy the sheet when the query goes desktop.

## Checklist

- [ ] `@alexapvl/drwr` installed; CSS imported only from the sheet module
- [ ] Host starts `hidden`; trigger has `aria-controls` + `aria-expanded`
- [ ] First open is a dynamic import; desktop never constructs `Sheet`
- [ ] Open snap hugs content (`setSnapPoints([0, content/max])`)
- [ ] `trapFocus` matches where the trigger lives
- [ ] Trigger ARIA flips on open, button-close, overlay, Escape, and drag-close
- [ ] Hamburger bars turn around their own centers and move before they turn (no ">" mid-frame, cross centered)
- [ ] Header z-index stays above the sheet until `onClose`
- [ ] `--drwr-*` tokens match the site
- [ ] In-sheet links close first, then navigate
- [ ] `destroy()` on breakpoint change and teardown
