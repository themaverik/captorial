/**
 * Pure tile geometry for the transform layer. No browser, no I/O: given the rendered content
 * height and a target aspect ratio, decide whether to emit a single image or a set of overlapping
 * 16:9 tiles, and where each tile clips.
 *
 * Extracted verbatim from the legacy in-page capture path so framing never changes; the unit tests
 * in tileGeometry.test.ts pin the behaviour.
 */

/** A screenshot clip rectangle, the shape Playwright's `page.screenshot({ clip })` expects. */
export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileGeometryInput {
  /** Full width of the capture (the viewport width). */
  width: number;
  /** Rendered content height available to capture (clamped to the grown viewport height). */
  usableHeight: number;
  /** Tile aspect ratio numerator / denominator (16 / 9 for desktop). */
  aspectWidth: number;
  aspectHeight: number;
  /** When false, emit one full-height image instead of 16:9 tiles. */
  cropTo169: boolean;
}

/** Height of one aspect-ratio tile at the given width. */
export const tileHeightFor = (width: number, aspectWidth: number, aspectHeight: number): number =>
  Math.round((width * aspectHeight) / aspectWidth);

/** Grow the viewport to `needed`, but never below the current height nor above the hard cap. */
export const clampViewportHeight = (needed: number, current: number, max: number): number =>
  Math.min(Math.max(needed, current), max);

/**
 * Clips to capture for the given content:
 *  - cropping disabled → one full-height image;
 *  - content fits one 16:9 frame → a single 16:9 crop;
 *  - taller → N overlapping 16:9 tiles at full width, evenly distributed so tile 1 is anchored to
 *    the top and the last tile to the bottom. The even spacing guarantees each pair of consecutive
 *    tiles overlaps a strip, giving visual continuity down a long form.
 */
export const computeTileClips = (input: TileGeometryInput): Clip[] => {
  const { width, usableHeight, aspectWidth, aspectHeight, cropTo169 } = input;
  const tileHeight = tileHeightFor(width, aspectWidth, aspectHeight);
  const shouldTile = cropTo169 && usableHeight > tileHeight + 1;

  if (!shouldTile) {
    const height = cropTo169 ? Math.min(usableHeight, tileHeight) : usableHeight;
    return [{ x: 0, y: 0, width, height }];
  }

  const tiles = Math.ceil(usableHeight / tileHeight);
  const travel = usableHeight - tileHeight; // total vertical distance the tile window moves
  const clips: Clip[] = [];
  for (let index = 0; index < tiles; index += 1) {
    const top = Math.round((index * travel) / (tiles - 1));
    clips.push({ x: 0, y: top, width, height: tileHeight });
  }
  return clips;
};
