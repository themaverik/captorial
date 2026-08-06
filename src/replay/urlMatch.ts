/**
 * URL handling for replay: resolving a step's `page:` against the base, and glob matching for its
 * `expect.url`. Supports `*` (any run of characters) in the pattern. A pattern with a scheme matches
 * the whole URL; a bare `/path` pattern matches the URL's path.
 */

/**
 * Resolve a step's `page:` path against the base URL. A recorded path is origin-relative, so it must
 * resolve against the base's *origin*, not be appended to it — appending doubles the prefix when
 * BASE_URL carries a path (base `https://host/app` + `/app/tasks` -> `https://host/app/app/tasks`).
 * An absolute `page:` is off-origin by construction and is never rebased.
 */
export const absoluteUrl = (pagePath: string, baseUrl?: string): string => {
  if (/^https?:\/\//i.test(pagePath)) return pagePath;
  if (!baseUrl) return pagePath;
  try {
    return new URL(pagePath, baseUrl).href;
  } catch {
    return pagePath;
  }
};

/** Escape regex metacharacters except `*`, which becomes `.*`. */
const globToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
};

export const urlMatches = (url: string, pattern: string): boolean => {
  const hasScheme = /^[a-z]+:\/\//i.test(pattern);
  const subject = hasScheme ? url : safePath(url);
  return globToRegExp(pattern).test(subject);
};

/** The pathname of a URL, or the raw string if it will not parse. */
const safePath = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/**
 * True when two URLs address the same page: same origin and path, ignoring the query and fragment.
 * Used to tell "the app already took us where the step wanted" from "we ended up somewhere else",
 * without treating a session id or a tracking parameter as a different page.
 */
export const samePage = (a: string, b: string): boolean => {
  try {
    const left = new URL(a);
    const right = new URL(b);
    const trim = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);
    return left.origin === right.origin && trim(left.pathname) === trim(right.pathname);
  } catch {
    return a === b;
  }
};
