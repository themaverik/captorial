/**
 * Record-time locator verification.
 *
 * `locatorFrom` derives candidates from raw element facts; this checks them against the live DOM
 * while the page is still in the state the user acted on. A candidate that does not resolve to the
 * recorded element *now* would never resolve at replay either, so it is dropped before it can reach
 * a spec. This is what bounds the cost of the name-derivation heuristic being approximate.
 *
 * Which element a tier found is decided by comparing bounding boxes against the one the observer
 * reported, so Playwright's own matching does the work rather than a second-guess of it.
 *
 * Preference: keep every tier that uniquely identifies the element and record no `nth`. Only when no
 * tier is unique does it fall back to one tier plus an index — `nth` applies to whichever tier wins
 * at replay, so pairing it with other tiers would misresolve them.
 */

import type { Locator, Page } from 'playwright';
import type { SpecLocator } from '../spec/types.js';
import { buildLocator, locatorTiers, type LocatorTier } from '../replay/locator.js';
import type { ElementRect } from './observer.js';

/** Bounding boxes within this many pixels describe the same element. */
const RECT_TOLERANCE_PX = 2;
/** Stop scanning a tier with more matches than this; it is far too generic to be worth an index. */
const MAX_MATCHES_SCANNED = 30;

export interface VerifiedLocator {
  locator: SpecLocator;
  /** Tiers confirmed to resolve to the recorded element. */
  tiers: LocatorTier[];
  /** True when the locator needed an index to be unambiguous. */
  ambiguous: boolean;
}

/** The candidate fields belonging to one tier. */
const pick = (locator: SpecLocator, tier: LocatorTier): SpecLocator => {
  if (tier === 'role+name') return { role: locator.role, name: locator.name };
  if (tier === 'testid') return { testid: locator.testid };
  return { text: locator.text };
};

/**
 * An element's position in document coordinates, measured in one page evaluation.
 *
 * Playwright's `boundingBox()` is viewport-relative, so converting it would mean reading the scroll
 * offset separately — and browsers animate the scroll that follows a focus change, so those two
 * reads can land at different offsets and disagree by hundreds of pixels. Measuring both together
 * inside the page removes the race.
 */
const documentPosition = (locator: Locator): Promise<{ x: number; y: number } | null> =>
  locator
    .evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { x: box.x + window.scrollX, y: box.y + window.scrollY };
    })
    .catch(() => null);

const samePosition = (position: { x: number; y: number }, rect: ElementRect): boolean =>
  Math.abs(position.x - rect.x) <= RECT_TOLERANCE_PX &&
  Math.abs(position.y - rect.y) <= RECT_TOLERANCE_PX;

/** Where the recorded element sits among this tier's matches, or null when the tier misses it. */
const findMatch = async (
  page: Page,
  candidate: SpecLocator,
  tier: LocatorTier,
  rect: ElementRect,
): Promise<{ index: number; count: number } | null> => {
  const base = buildLocator(page, { ...candidate, nth: undefined }, tier);
  const count = await base.count().catch(() => 0);
  if (!count || count > MAX_MATCHES_SCANNED) return null;
  for (let index = 0; index < count; index += 1) {
    const position = await documentPosition(base.nth(index));
    if (position && samePosition(position, rect)) return { index, count };
  }
  return null;
};

/**
 * Verify a derived locator against the page. Returns the candidates that actually resolve to the
 * recorded element, or null when none do — in which case the interaction cannot be replayed and the
 * caller should skip it rather than write a locator that is already broken.
 */
export const verifyLocator = async (
  page: Page,
  candidate: SpecLocator,
  rect: ElementRect,
): Promise<VerifiedLocator | null> => {
  const unique: SpecLocator = {};
  const uniqueTiers: LocatorTier[] = [];
  let indexed: { tier: LocatorTier; index: number } | null = null;

  for (const tier of locatorTiers(candidate)) {
    const match = await findMatch(page, candidate, tier, rect);
    if (!match) continue;
    if (match.count === 1) {
      Object.assign(unique, pick(candidate, tier));
      uniqueTiers.push(tier);
    } else if (!indexed) {
      indexed = { tier, index: match.index };
    }
  }

  if (uniqueTiers.length) return { locator: unique, tiers: uniqueTiers, ambiguous: false };
  if (indexed) {
    return {
      locator: { ...pick(candidate, indexed.tier), nth: indexed.index },
      tiers: [indexed.tier],
      ambiguous: true,
    };
  }
  return null;
};
