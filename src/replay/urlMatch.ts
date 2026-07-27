/**
 * Glob matching for a step's `expect.url`. Supports `*` (any run of characters) in the pattern.
 * A pattern with a scheme matches the whole URL; a bare `/path` pattern matches the URL's path.
 */

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
