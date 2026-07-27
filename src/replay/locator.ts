/**
 * Semantic locator resolution. A SpecLocator carries every candidate a recorder could capture; the
 * runner tries them in a fixed order (role+name -> testid -> text) and uses the first that matches,
 * logging which tier won so drift toward the weaker `text` tier is visible before it breaks.
 */

import type { Locator, Page } from 'playwright';
import type { SpecLocator } from '../spec/types.js';

export type LocatorTier = 'role+name' | 'testid' | 'text';

/** The candidate tiers this locator offers, in resolution order. Pure — no DOM needed. */
export const locatorTiers = (loc: SpecLocator): LocatorTier[] => {
  const tiers: LocatorTier[] = [];
  if (loc.role && loc.name) tiers.push('role+name');
  if (loc.testid) tiers.push('testid');
  if (loc.text) tiers.push('text');
  return tiers;
};

/** Build the Playwright Locator for one tier, applying `nth` disambiguation when present. */
export const buildLocator = (page: Page, loc: SpecLocator, tier: LocatorTier): Locator => {
  let locator: Locator;
  if (tier === 'role+name') {
    // Playwright's role type is a wide union; the spec stores it as a string by design.
    locator = page.getByRole(loc.role as Parameters<Page['getByRole']>[0], { name: loc.name });
  } else if (tier === 'testid') {
    locator = page.getByTestId(loc.testid as string);
  } else {
    locator = page.getByText(loc.text as string);
  }
  return loc.nth !== undefined ? locator.nth(loc.nth) : locator;
};

export interface ResolvedLocator {
  locator: Locator;
  tier: LocatorTier;
}

/**
 * Resolve to the first tier whose locator matches at least one element. Returns the Locator and the
 * tier used, or null if no candidate matches. `onTier` is called with the winning tier for logging.
 */
export const resolveLocator = async (
  page: Page,
  loc: SpecLocator,
  onTier?: (tier: LocatorTier) => void,
): Promise<ResolvedLocator | null> => {
  for (const tier of locatorTiers(loc)) {
    const locator = buildLocator(page, loc, tier);
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      onTier?.(tier);
      return { locator, tier };
    }
  }
  return null;
};
