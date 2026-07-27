/**
 * The transform layer: scales, frames, and stores screenshots. Stable boundary the spec pipeline
 * (recorder and replay runner) builds on. See docs/transform-contract.md.
 */

export { PageTransform } from './pageCapture.js';
export { clampViewportHeight, computeTileClips, tileHeightFor } from './tileGeometry.js';
export type { Clip, TileGeometryInput } from './tileGeometry.js';
export type { CaptureTargetOptions, TileCaptureOptions } from './types.js';
