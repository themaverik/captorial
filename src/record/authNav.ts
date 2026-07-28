/**
 * Detection of single-use auth-flow navigations.
 *
 * An OIDC/OAuth sign-in is a chain of redirects the browser performs on its own: the app bounces to
 * an authorization endpoint, the user submits credentials, and the provider bounces back to a
 * callback carrying an authorization code. Every URL in that chain is bound to one attempt — the
 * code is consumed on first exchange, `state` is a one-shot nonce, and `code_challenge` is the PKCE
 * verifier for that request alone. Recording them as `page:` steps produces a spec that can never
 * replay: navigating straight to a stale callback aborts.
 *
 * Dropping them is also what keeps credentials out of the spec file. The right behaviour on replay
 * is to visit the app and let it start a fresh sign-in, which regenerates all of these.
 */

/** Params that only ever appear in an auth exchange, and carry or bind a credential. */
const CREDENTIAL_PARAMS: ReadonlyArray<string> = [
  'access_token',
  'id_token',
  'session_state',
  'code_challenge',
];

/** Paths an auth exchange runs through, used to disambiguate the generic `code`/`state` params. */
const AUTH_PATH = /auth|callback|openid-connect|oauth|signin|sign-in|logout/i;

/**
 * True when a URL is a hop in an auth exchange rather than a page worth replaying.
 *
 * Deliberately conservative about `code` and `state`: both are ordinary query params an app may use
 * for its own purposes, so neither alone is enough. They count only together (the OAuth callback
 * signature) or on a path that is plainly part of an auth exchange.
 */
export const isAuthNavigation = (url: string): boolean => {
  let params: URLSearchParams;
  let pathname: string;
  try {
    // Resolve against a dummy base so a bare path parses the same way an absolute URL does.
    const parsed = new URL(url, 'https://spec.invalid');
    params = parsed.searchParams;
    pathname = parsed.pathname;
  } catch {
    return false;
  }
  if (CREDENTIAL_PARAMS.some((param) => params.has(param))) return true;
  const hasCode = params.has('code');
  const hasState = params.has('state');
  if (hasCode && hasState) return true;
  return (hasCode || hasState) && AUTH_PATH.test(pathname);
};
