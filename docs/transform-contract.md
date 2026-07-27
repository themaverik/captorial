# Transform contract

The transform layer scales, frames, and stores screenshots. It is the stable boundary the spec
pipeline (recorder and replay runner) builds on: everything that discovers or drives the target app
changes, but this layer's input and output stay fixed.

The logic used to live inside a legacy, app-specific page object bound to one app's DOM. The
behaviour was app-agnostic, but it was trapped behind that app's selectors. Phase 0 lifts it into
`src/transform/` with no behaviour change, parameterising the two app-specific assumptions (the
content root selector and the top-of-content anchor) so any app can call it.

## What it does

Given a live Playwright `Page` showing a form that scrolls inside a fixed-height panel, produce one
or more PNG files that read like the real web layout (page chrome plus the full form) while showing
every field.

The method: grow the viewport tall enough that the inner-scrolling panel expands to its full content
height, then capture. Short content yields a single image. Tall content is split top to bottom into
overlapping 16:9 tiles so nothing is lost and consecutive tiles share a strip for visual continuity.

## Public interface

`src/transform/index.ts` re-exports:

- `PageTransform` (from `pageCapture.ts`) — the Playwright-coupled capturer.
- `computeTileClips`, `tileHeightFor`, `clampViewportHeight` (from `tileGeometry.ts`) — the pure
  geometry, no browser needed.
- Types from `types.ts`.

### `class PageTransform`

```ts
new PageTransform(page: Page, options: TileCaptureOptions)
```

`TileCaptureOptions`:

| Field | Meaning |
|---|---|
| `cropTo169` | Crop to 16:9 tiles vs one long full-height image |
| `aspectWidth` / `aspectHeight` | Tile aspect ratio numerator / denominator |
| `maxViewportHeightPx` | Hard cap on how tall the viewport may grow |
| `capturePaddingPx` | Whitespace added around the content in `prepareForCapture` (element mode) |
| `contentSelector` | CSS selector for the content root to size to (default `form`) |
| `topAnchorSelectors` | Selectors tried in order to scroll tile 1 to the top; falls back to the content root |
| `onSettle` | Optional callback awaited after each viewport reflow (e.g. wait out an app spinner) |

The caller supplies its own defaults for `contentSelector`, `topAnchorSelectors`, and `onSettle`;
the module hard-codes none of them.

Methods:

- `growViewportToFitForm(): Promise<() => Promise<void>>` — grows the viewport to fit the content
  root's full height (clamped to `maxViewportHeightPx`), reflows, and returns a restore callback
  that sets the viewport back.
- `captureWebpageTiles(dir: string, base: string): Promise<string[]>` — grows, resets scroll,
  anchors tile 1 to the top, captures the tile(s), writes them, restores the viewport, and returns
  the absolute paths written. One file `<base>.png`, or `<base>-1.png`, `<base>-2.png`, … when
  tiled.
- `prepareForCapture(): Promise<void>` — for element-crop mode: unclips inner scroll containers and
  pads the content so an element screenshot lays out at full natural height.

### Pure geometry

```ts
tileHeightFor(width, aspectWidth, aspectHeight): number
clampViewportHeight(needed, current, max): number
computeTileClips({ width, usableHeight, aspectWidth, aspectHeight, cropTo169 }): Clip[]
```

`Clip` is `{ x, y, width, height }`, the shape Playwright's `page.screenshot({ clip })` takes.
`computeTileClips` returns one clip for the single-image case and N evenly distributed clips for the
tiled case (tile 1 anchored to the top, the last to the bottom).

## Output contract

- Files: `<dir>/<base>.png` (single) or `<dir>/<base>-<n>.png` (tiled, 1-based).
- The caller derives per-tile metadata (`part`, `partsTotal`) from the returned array length and
  writes it into its own manifest. That manifest is the caller's responsibility, not this layer's.

## Bounds sidecar (new pipeline, not yet built)

The replay runner will additionally record each shot's target `boundingBox()` and the device pixel
ratio into a sidecar JSON next to the PNG. `computeTileClips` already accepts explicit content bounds
via its `usableHeight` input, so feeding recorded bounds needs no change to this module. If a future
crop mode needs offline cropping of a captured PNG (rather than live clip capture), that is a new
function in this module, added without touching the existing capture path.

## What must not regress

- Byte-comparable output for the primary use case when called with the caller's existing defaults.
- The single-vs-tiled decision, tile count, and tile offsets are defined solely by
  `computeTileClips`; its unit tests pin that math.
