/**
 * Tests for review command parsing. The interactive loop is not covered here — what is worth pinning
 * down is that screen numbers become the right indices, and that a malformed command is rejected
 * rather than silently acting on step 0.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REVIEW_HELP, parseCommand } from './review.js';

test('the plain commands parse, whatever the case', () => {
  assert.deepEqual(parseCommand('w'), { kind: 'write' });
  assert.deepEqual(parseCommand('W'), { kind: 'write' });
  assert.deepEqual(parseCommand(' q '), { kind: 'quit' });
  assert.deepEqual(parseCommand('r'), { kind: 'render' });
  assert.deepEqual(parseCommand('?'), { kind: 'help' });
  assert.deepEqual(parseCommand('h'), { kind: 'help' });
});

test('an empty line re-prints the flow', () => {
  assert.deepEqual(parseCommand(''), { kind: 'render' });
  assert.deepEqual(parseCommand('   '), { kind: 'render' });
});

test('screen numbers are 1-based and become 0-based indices', () => {
  assert.deepEqual(parseCommand('d 2'), { kind: 'dropStep', step: 1 });
  assert.deepEqual(parseCommand('s 1'), { kind: 'dropShot', step: 0 });
  assert.deepEqual(parseCommand('i 3'), { kind: 'setShotId', step: 2 });
  assert.deepEqual(parseCommand('c 3'), { kind: 'setShotCrop', step: 2 });
  assert.deepEqual(parseCommand('m 3 1'), { kind: 'moveStep', step: 2, to: 0 });
  assert.deepEqual(parseCommand('v 2 1'), { kind: 'setActionValue', step: 1, action: 0 });
});

test('extra whitespace between arguments is tolerated', () => {
  assert.deepEqual(parseCommand('  m   3    1  '), { kind: 'moveStep', step: 2, to: 0 });
});

test('a command that needs a step number is rejected without a usable one', () => {
  for (const input of ['d', 'd 0', 'd -1', 'd x', 'd 1.5']) {
    assert.equal(parseCommand(input).kind, 'unknown', input);
  }
});

test('a two-argument command is rejected when the second is missing or bad', () => {
  assert.equal(parseCommand('m 1').kind, 'unknown');
  assert.equal(parseCommand('v 1 0').kind, 'unknown');
});

test('an unrecognised verb reports back what was typed', () => {
  assert.deepEqual(parseCommand('zzz 1'), { kind: 'unknown', input: 'zzz 1' });
});

test('every command the help advertises actually parses', () => {
  for (const line of REVIEW_HELP) {
    const verb = line.trim().split(/\s+/)[0];
    assert.notEqual(parseCommand(`${verb} 1 1`).kind, 'unknown', line);
  }
});
