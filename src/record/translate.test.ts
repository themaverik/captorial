/**
 * Tests for the pure decisions in translation. `pageMovedOn` is what tells a locator that genuinely
 * does not resolve apart from one that was never checked, because the interaction navigated first.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ElementDescriptor } from './elementInfo.js';
import { pageMovedOn, skipMessage } from './translate.js';

test('pageMovedOn is false when the page has not changed', () => {
  assert.equal(pageMovedOn('https://app.test/sign-in', 'https://app.test/sign-in'), false);
});

test('pageMovedOn is true once the interaction has navigated', () => {
  assert.equal(pageMovedOn('https://app.test/sign-in', 'https://app.test/home'), true);
});

test('pageMovedOn ignores the fragment, which does not reload the document', () => {
  assert.equal(pageMovedOn('https://app.test/form', 'https://app.test/form#section-2'), false);
  assert.equal(pageMovedOn('https://app.test/form#a', 'https://app.test/form#b'), false);
});

test('pageMovedOn treats a query change as a new page', () => {
  assert.equal(pageMovedOn('https://app.test/list', 'https://app.test/list?page=2'), true);
});

test('pageMovedOn notices an origin change', () => {
  assert.equal(pageMovedOn('https://app.test/sign-in', 'https://idp.test/authorize'), true);
});

const element = (over: Partial<ElementDescriptor> = {}): ElementDescriptor => ({
  tag: 'div',
  isPassword: false,
  ...over,
});

test('skipMessage names the element, the page, and what is missing', () => {
  const message = skipMessage(
    'click',
    element({ text: 'Select activity type' }),
    'unnamable',
    'https://app.test/ops/tasks/create?taskTypeId=abc',
  );
  assert.match(message, /click/);
  assert.match(message, /<div>/);
  assert.match(message, /Select activity type/);
  // The path, not the query — the query carries one-run ids and often a credential.
  assert.match(message, /\/ops\/tasks\/create/);
  assert.equal(message.includes('taskTypeId'), false);
  assert.match(message, /data-testid/);
});

test('skipMessage distinguishes an unnamable element from one whose locator missed', () => {
  const unnamable = skipMessage('click', element(), 'unnamable', 'https://app.test/x');
  const unmatched = skipMessage('click', element(), 'unmatched', 'https://app.test/x');
  assert.notEqual(unnamable, unmatched);
  // The two call for opposite fixes, so neither message may suggest the other's remedy.
  assert.match(unmatched, /matched nothing/);
  assert.equal(unmatched.includes('give it a data-testid'), false);
});

test('skipMessage falls back to the tag when an element has no label or text', () => {
  assert.match(skipMessage('fill', element({ tag: 'span' }), 'unnamable', 'not a url'), /"span"/);
});
