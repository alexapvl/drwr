# drwr

A zero-dependency, framework-agnostic bottom sheet / drawer component. Vanilla JS + CSS. Works in any project.

## Install

```bash
npm install drwr
```

## Usage

```js
import { Sheet } from "drwr";
import "drwr/style.css";

const sheet = new Sheet(document.getElementById("my-sheet"), {
  snapPoints: [0, 0.5, 1],
  defaultSnap: 0,
  overlay: true,
  dragHandle: true,
});

sheet.open();       // open to highest snap
sheet.open(0.5);    // open to specific snap
sheet.snapTo(0.5);
sheet.close();
sheet.refresh();    // re-measure after dynamic content change
sheet.destroy();
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `snapPoints` | `number[]` | `[0, 1]` | Normalized snap points from 0 to 1 (0 = closed, 1 = max height). Sanitized on input. |
| `defaultSnap` | `number` | `0` | Initial snap point. Non-zero values open with full state (scroll lock, focus trap, etc). |
| `overlay` | `boolean` | `true` | Show backdrop overlay |
| `dragHandle` | `boolean` | `true` | Render a drag handle bar |
| `damping` | `number` | `30` | Spring damping coefficient |
| `stiffness` | `number` | `200` | Spring stiffness coefficient |
| `closeThreshold` | `number` | `0.2` | Fraction of lowest snap below which the sheet closes on release |
| `topPadding` | `number` | `40` | Space left above the sheet at max height, in px |
| `width` | `number` | `60` (desktop) / `100` (mobile) | Width as % of viewport |
| `align` | `"center" \| "left" \| "right"` | `"center"` | Horizontal alignment |
| `sidePadding` | `number` | `0` | Minimum side padding in px |
| `maxWidth` | `number` | `0` | Max width in px (0 = no max) |
| `dragMode` | `"handle" \| "sheet" \| "none"` | `"sheet"` | Which part initiates drag |
| `ariaLabel` | `string` | `"Sheet"` | Accessible label for the dialog |
| `ariaLabelledBy` | `string` | — | ID of labelling element (overrides `ariaLabel`) |
| `closeOnEscape` | `boolean` | `true` | Close on Escape key |
| `closeOnOverlayClick` | `boolean` | `true` | Close on overlay click |
| `trapFocus` | `boolean` | `true` | Trap focus inside the sheet |
| `modal` | `boolean` | `true` | Set `aria-modal` |
| `reducedMotion` | `boolean` | `true` | Skip spring animation when user prefers reduced motion |
| `onOpen` | `() => void` | — | Called when sheet opens |
| `onClose` | `() => void` | — | Called when sheet closes |
| `onSnap` | `(point: number) => void` | — | Called when sheet snaps to a point |

## Methods

| Method | Description |
|--------|-------------|
| `open(point?)` | Open to the given snap (or highest). |
| `close()` | Close the sheet. |
| `snapTo(point)` | Animate to a specific snap point. |
| `refresh()` | Re-measure content height after dynamic changes. |
| `setSnapPoints(points)` | Replace snap points (sanitized). |
| `setLayout({ width?, align?, sidePadding? })` | Update layout at runtime. |
| `setOptions(opts)` | Merge partial options at runtime. |
| `destroy()` | Tear down the sheet and restore DOM. |

## Theming

All visual tokens are exposed as CSS custom properties:

```css
:root {
  --drwr-bg: #fff;
  --drwr-radius: 16px;
  --drwr-handle-width: 32px;
  --drwr-handle-height: 4px;
  --drwr-handle-color: rgba(0, 0, 0, 0.25);
  --drwr-overlay-color: rgba(0, 0, 0, 0.4);
  --drwr-shadow: 0 -1px 0 rgba(0, 0, 0, 0.04), 0 -8px 32px rgba(0, 0, 0, 0.12), 0 -24px 60px rgba(0, 0, 0, 0.06);
  --drwr-border: 1px solid rgba(0, 0, 0, 0.06);
  --drwr-z-index: 9999;
}
```

## License

MIT
