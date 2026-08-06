/**
 * Semantic locator resolution. A SpecLocator carries every candidate a recorder could capture; the
 * runner tries them in a fixed order (role+name -> testid -> label -> text) and uses the first that
 * matches, logging which tier won so drift toward the weaker `text` tier is visible before it breaks.
 */

import type { Locator, Page } from 'playwright';
import type { SpecLocator } from '../spec/types.js';

export type LocatorTier = 'role+name' | 'testid' | 'label' | 'text';

/** The candidate tiers this locator offers, in resolution order. Pure — no DOM needed. */
export const locatorTiers = (loc: SpecLocator): LocatorTier[] => {
  const tiers: LocatorTier[] = [];
  if (loc.role && loc.name) tiers.push('role+name');
  if (loc.testid) tiers.push('testid');
  if (loc.label) tiers.push('label');
  if (loc.text) tiers.push('text');
  return tiers;
};

/**
 * Short human description of a locator, for logs. Names the strongest candidate it carries, so a
 * warning identifies the element rather than only the action that failed on it.
 */
export const describeLocator = (loc: SpecLocator): string => {
  const scope = loc.within ? ` within ${describeLocator(loc.within)}` : '';
  if (loc.role && loc.name) return `${loc.role} "${loc.name}"${scope}`;
  if (loc.testid) return `testid "${loc.testid}"${scope}`;
  if (loc.label) return `label "${loc.label}"${scope}`;
  if (loc.text) return `text "${loc.text}"${scope}`;
  return 'a locator with no candidates';
};

/**
 * What a locator's tiers are searched in. `Page` and `Locator` expose the same `getBy*` methods, so
 * scoping is the same code against a narrower root.
 */
type SearchRoot = Pick<Page, 'getByRole' | 'getByTestId' | 'getByLabel' | 'getByText'>;

/**
 * The element a `within` scope names, resolved by its own strongest tier. A scope that matches
 * several elements narrows to the first: it exists to disambiguate the inner locator, so leaving it
 * ambiguous would defeat the point and trip Playwright's strict mode on the way.
 */
const scopeRoot = (page: Page, within: SpecLocator): SearchRoot => {
  const [strongest] = locatorTiers(within);
  if (!strongest) return page;
  return buildLocator(page, within, strongest).first();
};

/** Build the Playwright Locator for one tier, applying `within` scoping and `nth` when present. */
export const buildLocator = (page: Page, loc: SpecLocator, tier: LocatorTier): Locator => {
  const root: SearchRoot = loc.within ? scopeRoot(page, loc.within) : page;
  let locator: Locator;
  if (tier === 'role+name') {
    // Playwright's role type is a wide union; the spec stores it as a string by design.
    locator = root.getByRole(loc.role as Parameters<Page['getByRole']>[0], { name: loc.name });
  } else if (tier === 'testid') {
    locator = root.getByTestId(loc.testid as string);
  } else if (tier === 'label') {
    locator = root.getByLabel(loc.label as string);
  } else {
    locator = root.getByText(loc.text as string);
  }
  return loc.nth !== undefined ? locator.nth(loc.nth) : locator;
};

export interface ResolvedLocator {
  locator: Locator;
  tier: LocatorTier;
}

/**
 * How long any candidate is given to appear. `count()` is a snapshot and does not wait, so on an app
 * that renders after `domcontentloaded` — any SPA, and every hosted sign-in page — an unwaited check
 * resolves nothing and every step is skipped against a page that was merely still loading.
 */
export const DEFAULT_RESOLVE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;

/**
 * Resolve to the first tier whose locator matches at least one element, waiting up to `timeoutMs`
 * for one to appear. Returns the Locator and the tier used, or null if none matches in time.
 * `onTier` is called with the winning tier for logging.
 *
 * Every tier is retried on each pass rather than each being waited out in turn: the order encodes
 * preference, so a slow-rendering testid must still win over a `text` tier that happened to be in
 * the markup first, and one deadline covers the whole locator instead of one per tier.
 */
export const resolveLocator = async (
  page: Page,
  loc: SpecLocator,
  onTier?: (tier: LocatorTier) => void,
  timeoutMs: number = DEFAULT_RESOLVE_TIMEOUT_MS,
): Promise<ResolvedLocator | null> => {
  const tiers = locatorTiers(loc);
  if (!tiers.length) return null;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const tier of tiers) {
      const locator = buildLocator(page, loc, tier);
      const count = await locator.count().catch(() => 0);
      if (count > 0) {
        onTier?.(tier);
        return { locator, tier };
      }
    }
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(POLL_INTERVAL_MS).catch(() => undefined);
  }
};
