/**
 * Tests for display-derived viewport sizing. Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_VIEWPORT, fitViewport, parseViewport } from './display.js';

/** A 1366x768 laptop with the taskbar and browser chrome taken out. */
const SMALL = { availWidth: 1366, availHeight: 720, chromeHeight: 87 };
const LARGE = { availWidth: 2560, availHeight: 1400, chromeHeight: 87 };

test('fitViewport returns the preferred size when no display is known', () => {
  assert.deepEqual(fitViewport(DEFAULT_VIEWPORT, null), DEFAULT_VIEWPORT);
});

test('fitViewport never grows the viewport on a large display', () => {
  assert.deepEqual(fitViewport(DEFAULT_VIEWPORT, LARGE), DEFAULT_VIEWPORT);
});

test('fitViewport shrinks to fit a display smaller than the preferred size', () => {
  const fitted = fitViewport(DEFAULT_VIEWPORT, SMALL);
  assert.ok(fitted.width <= SMALL.availWidth);
  assert.ok(fitted.height <= SMALL.availHeight - SMALL.chromeHeight);
});

test('fitViewport preserves the aspect ratio when it shrinks', () => {
  const fitted = fitViewport(DEFAULT_VIEWPORT, SMALL);
  const preferred = DEFAULT_VIEWPORT.width / DEFAULT_VIEWPORT.height;
  assert.ok(Math.abs(fitted.width / fitted.height - preferred) < 0.01);
});

test('fitViewport is bound by height when height is the tighter constraint', () => {
  // Wide but short: width alone would allow the full 1920, height caps it.
  const fitted = fitViewport(DEFAULT_VIEWPORT, { availWidth: 3000, availHeight: 640, chromeHeight: 100 });
  assert.deepEqual(fitted, { width: 960, height: 540 });
});

test('fitViewport never returns a zero or negative dimension', () => {
  const fitted = fitViewport(DEFAULT_VIEWPORT, { availWidth: 1, availHeight: 1, chromeHeight: 400 });
  assert.ok(fitted.width >= 1);
  assert.ok(fitted.height >= 1);
});

test('parseViewport reads a WIDTHxHEIGHT override', () => {
  assert.deepEqual(parseViewport('1600x900'), { width: 1600, height: 900 });
  assert.deepEqual(parseViewport(' 1280 X 720 '), { width: 1280, height: 720 });
});

test('parseViewport returns undefined for anything unparseable', () => {
  assert.equal(parseViewport(undefined), undefined);
  assert.equal(parseViewport(''), undefined);
  assert.equal(parseViewport('1920'), undefined);
  assert.equal(parseViewport('0x1080'), undefined);
  assert.equal(parseViewport('wide x tall'), undefined);
});
