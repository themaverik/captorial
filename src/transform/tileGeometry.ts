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

export interface AnchoredClipInput {
  /** Full width of the capture (the viewport width). */
  width: number;
  /** Rendered content height available to capture (clamped to the grown viewport height). */
  contentHeight: number;
  /** Y offset of the element the frame is anchored to, in the same space as `contentHeight`. */
  anchorY: number;
  aspectWidth: number;
  aspectHeight: number;
  /** Context kept above the anchor so it does not sit flush against the frame's top edge. */
  headroomPx?: number;
}

/**
 * One aspect-ratio frame whose top edge sits at `anchorY` (less `headroomPx`), clamped so the frame
 * never starts above the content nor runs past its bottom. Content shorter than one frame collapses
 * to the content height.
 *
 * This is the manually staged counterpart to `computeTileClips`. Tiling slices a single static
 * snapshot, so it cannot express a page whose state changes between frames (a dropdown opened, a
 * section expanded); an anchored frame is captured against whatever state is live at that moment,
 * and continuity between frames comes from the caller anchoring frame N+1 to an element that was
 * visible in frame N.
 */
export const anchoredClip = (input: AnchoredClipInput): Clip => {
  const { width, contentHeight, anchorY, aspectWidth, aspectHeight, headroomPx = 0 } = input;
  const height = Math.min(tileHeightFor(width, aspectWidth, aspectHeight), contentHeight);
  const maxTop = Math.max(0, contentHeight - height);
  const top = Math.min(Math.max(0, Math.round(anchorY - headroomPx)), maxTop);
  return { x: 0, y: top, width, height };
};

/**
 * True when a frame starting at `nextAnchorY` continues on from a frame of `frameHeight` starting at
 * `prevTop` — i.e. the next anchor was still inside the previous frame, so no content falls between
 * them. Pure so the recorder can flag a coverage gap while the page is still open.
 */
export const framesAreContinuous = (
  prevTop: number,
  frameHeight: number,
  nextAnchorY: number,
): boolean => nextAnchorY <= prevTop + frameHeight;
