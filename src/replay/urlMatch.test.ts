/**
 * Tests for glob URL matching used by a step's `expect.url`. Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absoluteUrl, samePage, urlMatches } from './urlMatch.js';

test('samePage ignores the query and fragment but not the path', () => {
  assert.equal(samePage('https://h/ops/tasks?a=1', 'https://h/ops/tasks'), true);
  assert.equal(samePage('https://h/ops/tasks#x', 'https://h/ops/tasks'), true);
  assert.equal(samePage('https://h/ops/tasks/', 'https://h/ops/tasks'), true);
  assert.equal(samePage('https://h/ops', 'https://h/ops/tasks'), false);
});

test('samePage treats a different origin as a different page', () => {
  assert.equal(samePage('https://h/ops', 'https://other/ops'), false);
});

test('absoluteUrl does not double a path prefix already carried by the base URL', () => {
  // Recorded paths are origin-relative, so the base's own path must not be prepended again.
  assert.equal(
    absoluteUrl('/app/tasks', 'https://host.example/app'),
    'https://host.example/app/tasks',
  );
  assert.equal(
    absoluteUrl('/app/tasks', 'https://host.example/app/'),
    'https://host.example/app/tasks',
  );
});

test('absoluteUrl resolves against a base with no path', () => {
  assert.equal(absoluteUrl('/tasks', 'https://host.example'), 'https://host.example/tasks');
  assert.equal(absoluteUrl('/tasks?a=1', 'https://host.example'), 'https://host.example/tasks?a=1');
});

test('absoluteUrl leaves an absolute page path unrebased', () => {
  assert.equal(
    absoluteUrl('https://other.example/x', 'https://host.example/app'),
    'https://other.example/x',
  );
});

test('absoluteUrl returns the path unchanged when there is no base URL', () => {
  assert.equal(absoluteUrl('/tasks', undefined), '/tasks');
});


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
