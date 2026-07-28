/**
 * Tests for single-use auth-navigation detection. Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAuthNavigation } from './authNav.js';

test('isAuthNavigation flags an OIDC callback carrying an authorization code', () => {
  assert.equal(
    isAuthNavigation('/app/auth-callback?state=abc&session_state=def&code=ghi.jkl.mno'),
    true,
  );
});

test('isAuthNavigation flags an authorization request carrying a PKCE challenge', () => {
  assert.equal(
    isAuthNavigation(
      '/realms/example/protocol/openid-connect/auth?client_id=web&response_type=code' +
        '&state=abc&code_challenge=xyz&code_challenge_method=S256',
    ),
    true,
  );
});

test('isAuthNavigation flags implicit-flow tokens in the query', () => {
  assert.equal(isAuthNavigation('/callback?access_token=abc'), true);
  assert.equal(isAuthNavigation('/callback?id_token=abc'), true);
});

test('isAuthNavigation leaves ordinary pages alone', () => {
  assert.equal(isAuthNavigation('/tasks'), false);
  assert.equal(isAuthNavigation('/tasks/create?taskTypeId=5ad6392d-a276-4e98'), false);
  assert.equal(isAuthNavigation('/reports?page=2&sort=name'), false);
});

test('isAuthNavigation does not flag a bare code or state on an ordinary path', () => {
  // Both are ordinary param names an app may use for its own purposes.
  assert.equal(isAuthNavigation('/products?code=SKU-1234'), false);
  assert.equal(isAuthNavigation('/orders?state=pending'), false);
});

test('isAuthNavigation flags a bare code or state on an auth path', () => {
  assert.equal(isAuthNavigation('/auth/callback?code=abc'), true);
  assert.equal(isAuthNavigation('/oauth/authorize?state=abc'), true);
});

test('isAuthNavigation handles absolute URLs and unparseable input', () => {
  assert.equal(isAuthNavigation('https://id.example/callback?code=a&state=b'), true);
  assert.equal(isAuthNavigation('https://app.example/tasks'), false);
  assert.equal(isAuthNavigation('::::'), false);
});
