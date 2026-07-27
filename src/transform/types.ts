/** Public types for the transform layer. */

/** App-specific hooks the capturer needs; the caller supplies defaults for its own use case. */
export interface CaptureTargetOptions {
  /** CSS selector for the content root whose full height should be captured. Default 'form'. */
  contentSelector?: string;
  /**
   * Selectors tried in order to scroll the top of the content to the top of tile 1 (e.g. a first
   * section anchor). The first that matches is used; falls back to the content root.
   */
  topAnchorSelectors?: string[];
  /** Awaited after each viewport reflow so the caller can wait out an app-specific spinner. */
  onSettle?: () => Promise<void>;
}

/** Everything the capturer needs, so it reads no app config directly. */
export interface TileCaptureOptions extends CaptureTargetOptions {
  /** Crop to 16:9 tiles vs one long full-height image. */
  cropTo169: boolean;
  /** Tile aspect ratio numerator / denominator (16 / 9 for desktop). */
  aspectWidth: number;
  aspectHeight: number;
  /** Hard cap (px) on how tall the viewport may grow. */
  maxViewportHeightPx: number;
  /** Whitespace (px) added around the form in `prepareForCapture` ('form' capture mode). */
  capturePaddingPx: number;
  /** Context (px) kept above the anchor in `captureAnchoredFrame`. Default 0. */
  anchorHeadroomPx?: number;
}
