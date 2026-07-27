/**
 * Tests for the pure part of locator resolution: which candidate tiers a SpecLocator offers, and in
 * what order. Actual DOM resolution is Playwright-coupled and exercised against a live app.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locatorTiers } from './locator.js';

test('locatorTiers lists role+name, testid, text in resolution order', () => {
  assert.deepEqual(
    locatorTiers({ role: 'button', name: 'Sign in', testid: 'signin', text: 'Sign in' }),
    ['role+name', 'testid', 'text'],
  );
});

test('locatorTiers needs both role and name for the role+name tier', () => {
  assert.deepEqual(locatorTiers({ role: 'button' }), []);
  assert.deepEqual(locatorTiers({ name: 'Sign in' }), []);
  assert.deepEqual(locatorTiers({ role: 'button', name: 'Sign in' }), ['role+name']);
});

test('locatorTiers falls back to testid then text', () => {
  assert.deepEqual(locatorTiers({ testid: 'x' }), ['testid']);
  assert.deepEqual(locatorTiers({ text: 'Continue' }), ['text']);
  assert.deepEqual(locatorTiers({ testid: 'x', text: 'Continue' }), ['testid', 'text']);
});

test('locatorTiers returns nothing for an empty locator', () => {
  assert.deepEqual(locatorTiers({}), []);
});
