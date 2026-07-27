/**
 * Unit tests for the pure tile geometry. These pin the single-vs-tiled decision, tile count, and
 * tile offsets extracted verbatim from the legacy in-page capture path, so the transform module can
 * never silently change framing.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampViewportHeight, computeTileClips, tileHeightFor } from './tileGeometry.js';

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
