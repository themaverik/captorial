/**
 * Tests for the pure part of locator resolution: which candidate tiers a SpecLocator offers, and in
 * what order. Actual DOM resolution is Playwright-coupled and exercised against a live app.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeLocator, locatorTiers } from './locator.js';

test('locatorTiers lists role+name, testid, label, text in resolution order', () => {
  assert.deepEqual(
    locatorTiers({ role: 'button', name: 'Sign in', testid: 'signin', label: 'Sign in', text: 'Sign in' }),
    ['role+name', 'testid', 'label', 'text'],
  );
});

test('locatorTiers needs both role and name for the role+name tier', () => {
  assert.deepEqual(locatorTiers({ role: 'button' }), []);
  assert.deepEqual(locatorTiers({ name: 'Sign in' }), []);
  assert.deepEqual(locatorTiers({ role: 'button', name: 'Sign in' }), ['role+name']);
});

test('locatorTiers falls back to testid then label then text', () => {
  assert.deepEqual(locatorTiers({ testid: 'x' }), ['testid']);
  assert.deepEqual(locatorTiers({ text: 'Continue' }), ['text']);
  assert.deepEqual(locatorTiers({ testid: 'x', text: 'Continue' }), ['testid', 'text']);
  // The only tier a control with no implicit role can offer.
  assert.deepEqual(locatorTiers({ label: 'Password' }), ['label']);
  assert.deepEqual(locatorTiers({ label: 'Password', text: 'x' }), ['label', 'text']);
});

test('locatorTiers returns nothing for an empty locator', () => {
  assert.deepEqual(locatorTiers({}), []);
});

test('within is scoping, not a tier, so it adds no candidate of its own', () => {
  // A scope cannot make an otherwise unlocatable element locatable.
  assert.deepEqual(locatorTiers({ within: { testid: 'panel' } }), []);
  assert.deepEqual(locatorTiers({ text: 'Select', within: { testid: 'panel' } }), ['text']);
});

test('describeLocator reports the scope so a warning says which one it meant', () => {
  assert.equal(
    describeLocator({ text: 'Select species', within: { testid: 'species-0' } }),
    'text "Select species" within testid "species-0"',
  );
});

test('describeLocator names the strongest candidate a locator carries', () => {
  assert.equal(describeLocator({ role: 'button', name: 'Save', testid: 's' }), 'button "Save"');
  assert.equal(describeLocator({ testid: 'report-save', text: 'Save' }), 'testid "report-save"');
  assert.equal(describeLocator({ label: 'Password' }), 'label "Password"');
  assert.equal(describeLocator({ text: 'Continue' }), 'text "Continue"');
  // role without name is not a usable tier, so it is not what the warning should name.
  assert.equal(describeLocator({ role: 'button' }), 'a locator with no candidates');
});
