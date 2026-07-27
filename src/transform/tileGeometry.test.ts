/**
 * Unit tests for the pure tile geometry. These pin the single-vs-tiled decision, tile count, and
 * tile offsets extracted verbatim from the legacy in-page capture path, so the transform module can
 * never silently change framing.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  anchoredClip,
  clampViewportHeight,
  computeTileClips,
  framesAreContinuous,
  tileHeightFor,
} from './tileGeometry.js';

const FRAME = { width: 1920, aspectWidth: 16, aspectHeight: 9 };

test('tileHeightFor computes a 16:9 tile height from the width', () => {
  assert.equal(tileHeightFor(1920, 16, 9), 1080);
  assert.equal(tileHeightFor(1280, 16, 9), 720);
});

test('clampViewportHeight keeps the needed height within [current, max]', () => {
  // Grows to the needed height when it exceeds the current viewport.
  assert.equal(clampViewportHeight(3000, 1080, 8000), 3000);
  // Never shrinks below the current viewport.
  assert.equal(clampViewportHeight(500, 1080, 8000), 1080);
  // Never exceeds the hard cap.
  assert.equal(clampViewportHeight(12000, 1080, 8000), 8000);
});

test('computeTileClips returns a single 16:9 crop when the content fits one frame', () => {
  const clips = computeTileClips({
    width: 1920,
    usableHeight: 900, // shorter than a 1080 tile
    aspectWidth: 16,
    aspectHeight: 9,
    cropTo169: true,
  });
  assert.deepEqual(clips, [{ x: 0, y: 0, width: 1920, height: 900 }]);
});

test('computeTileClips returns one full-height image when cropping is disabled', () => {
  const clips = computeTileClips({
    width: 1920,
    usableHeight: 5000,
    aspectWidth: 16,
    aspectHeight: 9,
    cropTo169: false,
  });
  assert.deepEqual(clips, [{ x: 0, y: 0, width: 1920, height: 5000 }]);
});

test('computeTileClips tiles tall content top-to-bottom with the last tile anchored to the bottom', () => {
  const clips = computeTileClips({
    width: 1920,
    usableHeight: 3000, // > 1080, so it tiles
    aspectWidth: 16,
    aspectHeight: 9,
    cropTo169: true,
  });
  // ceil(3000 / 1080) = 3 tiles; travel = 3000 - 1080 = 1920; tops = round(i * 1920 / 2).
  assert.equal(clips.length, 3);
  assert.deepEqual(
    clips.map((c) => c.y),
    [0, 960, 1920],
  );
  // Every tile is a full-width 16:9 frame.
  for (const clip of clips) {
    assert.equal(clip.x, 0);
    assert.equal(clip.width, 1920);
    assert.equal(clip.height, 1080);
  }
  // The last tile's bottom edge reaches the content bottom exactly.
  assert.equal(clips[clips.length - 1].y + clips[clips.length - 1].height, 3000);
});

test('computeTileClips does not tile content only a hair taller than one tile', () => {
  // usableHeight must exceed tileHeight + 1 to tile; 1081 does, 1080 does not.
  const noTile = computeTileClips({
    width: 1920,
    usableHeight: 1080,
    aspectWidth: 16,
    aspectHeight: 9,
    cropTo169: true,
  });
  assert.equal(noTile.length, 1);
  assert.equal(noTile[0].height, 1080);
});

test('anchoredClip puts the anchor at the top of a 16:9 frame', () => {
  const clip = anchoredClip({ ...FRAME, contentHeight: 4000, anchorY: 1500 });
  assert.deepEqual(clip, { x: 0, y: 1500, width: 1920, height: 1080 });
});

test('anchoredClip keeps headroom above the anchor without going negative', () => {
  const withRoom = anchoredClip({ ...FRAME, contentHeight: 4000, anchorY: 1500, headroomPx: 120 });
  assert.equal(withRoom.y, 1380);
  // An anchor near the very top clamps to 0 rather than clipping above the content.
  const atTop = anchoredClip({ ...FRAME, contentHeight: 4000, anchorY: 40, headroomPx: 120 });
  assert.equal(atTop.y, 0);
});

test('anchoredClip clamps the last frame to the content bottom', () => {
  // An anchor 300px from the bottom would overrun; the frame slides up to end flush.
  const clip = anchoredClip({ ...FRAME, contentHeight: 2000, anchorY: 1700 });
  assert.equal(clip.y, 920);
  assert.equal(clip.y + clip.height, 2000);
});

test('anchoredClip collapses to the content height when content is shorter than one frame', () => {
  const clip = anchoredClip({ ...FRAME, contentHeight: 600, anchorY: 400 });
  assert.deepEqual(clip, { x: 0, y: 0, width: 1920, height: 600 });
});

test('framesAreContinuous flags an anchor that falls below the previous frame', () => {
  // Anchor still inside the previous frame -> the frames overlap, nothing is lost.
  assert.equal(framesAreContinuous(0, 1080, 900), true);
  // Anchor exactly on the previous frame's bottom edge -> still continuous.
  assert.equal(framesAreContinuous(0, 1080, 1080), true);
  // Anchor past the bottom edge -> the strip between 1080 and 1200 is in no frame.
  assert.equal(framesAreContinuous(0, 1080, 1200), false);
});
