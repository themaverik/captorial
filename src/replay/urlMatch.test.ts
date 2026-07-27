/**
 * Tests for glob URL matching used by a step's `expect.url`. Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { urlMatches } from './urlMatch.js';

test('urlMatches matches a trailing wildcard against the path', () => {
  assert.equal(urlMatches('https://app.example/projects/42', '/projects/*'), true);
  assert.equal(urlMatches('https://app.example/projects/42/edit', '/projects/*'), true);
  assert.equal(urlMatches('https://app.example/login', '/projects/*'), false);
});

test('urlMatches matches a full absolute pattern', () => {
  assert.equal(urlMatches('https://app.example/login', 'https://app.example/login'), true);
  assert.equal(urlMatches('https://app.example/login', 'https://other.example/login'), false);
});

test('urlMatches treats a bare path pattern as a suffix on the URL path', () => {
  assert.equal(urlMatches('https://app.example/login', '/login'), true);
  assert.equal(urlMatches('https://app.example/x/login', '/login'), false);
});
