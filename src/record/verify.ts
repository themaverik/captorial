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
  status: 'verified';
  locator: SpecLocator;
  /** Tiers confirmed to resolve to the recorded element. */
  tiers: LocatorTier[];
  /** True when the locator needed an index to be unambiguous. */
  ambiguous: boolean;
}

/**
 * Verification runs after the interaction it describes, so an interaction that navigates — a submit,
 * a sign-in, a link — can take its own page away first. That has to be told apart from a real miss:
 * `unmatched` means the page was there and no candidate found the element, so the locator would fail
 * at replay too; `unverifiable` means the check never got to run and proves nothing either way.
 */
export type VerifyOutcome = VerifiedLocator | { status: 'unmatched' } | { status: 'unverifiable' };

/**
 * The candidate fields belonging to one tier. `within` rides along with every tier: it is scoping
 * rather than a candidate, and the verified tier only resolved because the search was narrowed, so
 * dropping it here would store a locator that never matched anything.
 */
const pick = (locator: SpecLocator, tier: LocatorTier): SpecLocator => {
  const scope = locator.within ? { within: locator.within } : {};
  if (tier === 'role+name') return { ...scope, role: locator.role, name: locator.name };
  if (tier === 'testid') return { ...scope, testid: locator.testid };
  if (tier === 'label') return { ...scope, label: locator.label };
  return { ...scope, text: locator.text };
};

/**
 * An element's position in document coordinates, measured in one page evaluation.
 *
 * Playwright's `boundingBox()` is viewport-relative, so converting it would mean reading the scroll
 * offset separately — and browsers animate the scroll that follows a focus change, so those two
 * reads can land at different offsets and disagree by hundreds of pixels. Measuring both together
 * inside the page removes the race.
 */
const documentPosition = (locator: Locator): Promise<{ x: number; y: number }> =>
  locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { x: box.x + window.scrollX, y: box.y + window.scrollY };
  });

const samePosition = (position: { x: number; y: number }, rect: ElementRect): boolean =>
  Math.abs(position.x - rect.x) <= RECT_TOLERANCE_PX &&
  Math.abs(position.y - rect.y) <= RECT_TOLERANCE_PX;

/**
 * Where the recorded element sits among this tier's matches, a clean miss, or a page that moved out
 * from under the check. Querying a document that is being replaced throws, and swallowing that as a
 * miss is what silently drops every interaction that navigates.
 */
type TierMatch = { index: number; count: number } | 'miss' | 'unverifiable';

const findMatch = async (
  page: Page,
  candidate: SpecLocator,
  tier: LocatorTier,
  rect: ElementRect,
): Promise<TierMatch> => {
  const base = buildLocator(page, { ...candidate, nth: undefined }, tier);
  try {
    const count = await base.count();
    if (!count || count > MAX_MATCHES_SCANNED) return 'miss';
    for (let index = 0; index < count; index += 1) {
      const position = await documentPosition(base.nth(index));
      if (samePosition(position, rect)) return { index, count };
    }
  } catch {
    return 'unverifiable';
  }
  return 'miss';
};

/**
 * Verify a derived locator against the page. Returns the candidates that actually resolve to the
 * recorded element; `unmatched` when none do — the interaction cannot be replayed, so the caller
 * should skip it rather than write a locator that is already broken — or `unverifiable` when the
 * page moved before the check could run, which is not evidence against the locator.
 */
export const verifyLocator = async (
  page: Page,
  candidate: SpecLocator,
  rect: ElementRect,
): Promise<VerifyOutcome> => {
  const unique: SpecLocator = {};
  const uniqueTiers: LocatorTier[] = [];
  let indexed: { tier: LocatorTier; index: number } | null = null;
  let unverifiable = false;

  for (const tier of locatorTiers(candidate)) {
    const match = await findMatch(page, candidate, tier, rect);
    if (match === 'unverifiable') {
      unverifiable = true;
      continue;
    }
    if (match === 'miss') continue;
    if (match.count === 1) {
      Object.assign(unique, pick(candidate, tier));
      uniqueTiers.push(tier);
    } else if (!indexed) {
      indexed = { tier, index: match.index };
    }
  }

  if (uniqueTiers.length) {
    return { status: 'verified', locator: unique, tiers: uniqueTiers, ambiguous: false };
  }
  if (indexed) {
    return {
      status: 'verified',
      locator: { ...pick(candidate, indexed.tier), nth: indexed.index },
      tiers: [indexed.tier],
      ambiguous: true,
    };
  }
  return { status: unverifiable ? 'unverifiable' : 'unmatched' };
};
