/**
 * Tests for path-safety helpers: sanitizeName must neutralise traversal, and isWithinRoot must
 * reject paths that escape the output root. Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWithinRoot, sanitizeName } from './utils.js';

test('sanitizeName strips path separators and reserved characters', () => {
  assert.equal(sanitizeName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
});

test('sanitizeName collapses whitespace and trims', () => {
  assert.equal(sanitizeName('  hello   world  '), 'hello world');
});

test('sanitizeName neutralises "." and ".." so they cannot traverse', () => {
  assert.equal(sanitizeName('..'), '');
  assert.equal(sanitizeName('.'), '');
  assert.equal(sanitizeName('../../etc/passwd'), 'etcpasswd');
  assert.equal(sanitizeName('..evil'), 'evil');
});

test('sanitizeName keeps internal dots', () => {
  assert.equal(sanitizeName('3.1.17'), '3.1.17');
  assert.equal(sanitizeName('01-baseline'), '01-baseline');
});

test('isWithinRoot accepts the root itself and paths inside it', () => {
  assert.equal(isWithinRoot('/out', '/out'), true);
  assert.equal(isWithinRoot('/out', '/out/a/b.png'), true);
});

test('isWithinRoot rejects traversal and absolute-outside paths', () => {
  assert.equal(isWithinRoot('/out', '/out/../etc'), false);
  assert.equal(isWithinRoot('/out', '/etc/passwd'), false);
});
