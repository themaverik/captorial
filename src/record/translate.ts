/**
 * Translation from an observed browser interaction into a recorded event.
 *
 * Sits between the observer (raw facts from the page) and the step builder (pure assembly): derives
 * locator candidates, verifies them against the live page, and decides what — if anything — the
 * interaction means for the spec. Kept apart from the session so it can be driven against a fixture
 * page without standing up a whole recording.
 */

import type { Page } from 'playwright';
import type { SpecLocator } from '../spec/types.js';
import { anchoredClip } from '../transform/index.js';
import { attributeClick } from './attribute.js';
import type { ElementDescriptor } from './elementInfo.js';
import { fieldLabel, hasCandidate, locatorFor } from './locatorFrom.js';
import type { ElementRect, ObservedEvent } from './observer.js';
import type { RecordedEvent, SecretKind } from './stepBuilder.js';
import { verifyLocator } from './verify.js';

export interface TranslateConfig {
  /** The address the user signed in with, so its value becomes an env var rather than a literal. */
  email: string;
  aspectWidth: number;
  aspectHeight: number;
}

export interface TranslateSink {
  event: (event: RecordedEvent) => void;
  warn: (message: string) => void;
  /** An interaction with no resolvable locator, described so the operator can act on it. */
  skip: (message: string) => void;
  note?: (message: string) => void;
}

/** Why an interaction yielded no locator. The two need different remedies, so they are kept apart. */
export type SkipReason = 'unnamable' | 'unmatched';

/** How the user would refer to this element. */
export const describeElement = (element: ElementDescriptor): string =>
  fieldLabel(element) ?? element.text ?? element.tag;

/** Pathname of a URL, or the raw string when it will not parse. */
const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/**
 * Why an interaction was not recorded, in terms the operator can act on: what was interacted with,
 * on which page, and what to change. Reported per element rather than as a tally — a bare count
 * cannot tell you whether a dropdown trigger needs a `data-testid` or whether the derived locator
 * was simply wrong, and those call for opposite fixes.
 */
export const skipMessage = (
  what: string,
  element: ElementDescriptor,
  reason: SkipReason,
  url: string,
): string => {
  const why =
    reason === 'unnamable'
      ? 'it offers no role+name, data-testid, label, or short text — give it a data-testid'
      : 'the locator derived for it matched nothing on the page';
  return `${what} on <${element.tag}> "${describeElement(element)}" at ${pathOf(url)} was not recorded: ${why}`;
};

/**
 * True when the page is no longer the one the interaction happened on. Compared without the
 * fragment: a hash change leaves the document — and so the recorded element — in place.
 */
export const pageMovedOn = (urlAtEvent: string, urlNow: string): boolean =>
  urlAtEvent.split('#')[0] !== urlNow.split('#')[0];

/**
 * A password is recognised by its input type, never by comparing its value — the observer withholds
 * password values entirely, so there is nothing to compare.
 */
const secretFor = (element: ElementDescriptor, email: string): SecretKind | undefined => {
  if (element.isPassword) return 'password';
  if (email && element.value === email) return 'email';
  return undefined;
};

export const createTranslator = (
  config: TranslateConfig,
  sink: TranslateSink,
): ((page: Page, observed: ObservedEvent) => Promise<void>) => {
  const toLocator = async (
    page: Page,
    element: ElementDescriptor,
    rect: ElementRect,
    urlAtEvent: string,
    scope?: ElementDescriptor,
  ): Promise<{ locator: SpecLocator } | { locator: null; reason: SkipReason }> => {
    const base = locatorFor(element);
    // A scope only helps if it can be located itself; an unnamable container narrows nothing.
    const scopeLocator = scope ? locatorFor(scope) : undefined;
    const candidate: SpecLocator =
      scopeLocator && hasCandidate(scopeLocator) ? { ...base, within: scopeLocator } : base;
    if (!hasCandidate(candidate)) return { locator: null, reason: 'unnamable' };
    const outcome = await verifyLocator(page, candidate, rect);
    if (outcome.status === 'verified') {
      if (outcome.ambiguous) {
        sink.warn(
          `"${describeElement(element)}" matched several elements and was recorded by position — ` +
            `add a data-testid to make it stable`,
        );
      }
      return { locator: outcome.locator };
    }
    // Verification happens after the fact, so an interaction that navigates — a sign-in, a submit,
    // a link — is checked against a page that has already moved on. Dropping it there loses the one
    // step that carries the flow forward, so keep the derived locator and say it went unchecked.
    if (outcome.status === 'unverifiable' || pageMovedOn(urlAtEvent, page.url())) {
      sink.warn(
        `"${describeElement(element)}" navigated the page before its locator could be checked — ` +
          `recorded unverified; confirm it on the first replay`,
      );
      return { locator: candidate };
    }
    return { locator: null, reason: 'unmatched' };
  };

  return async (page, observed) => {
    if (observed.kind === 'shot-fullpage') {
      sink.event({ kind: 'shot', crop: 'fullpage', label: 'page' });
      sink.note?.('shot: whole page, auto-tiled');
      return;
    }

    if (observed.kind === 'shot-anchored') {
      if (!observed.element || !observed.rect || observed.anchorY === null) {
        sink.warn(
          'a frame shot found no usable anchor on screen — scroll so a labelled element sits near the top',
        );
        return;
      }
      const anchored = await toLocator(page, observed.element, observed.rect, observed.url);
      if (!anchored.locator) {
        sink.warn(`a frame anchored to "${describeElement(observed.element)}" could not be located — skipped`);
        return;
      }
      const anchor = anchored.locator;
      const label = describeElement(observed.element);
      // Approximate the frame the way replay will, so a coverage gap surfaces now rather than in the
      // captured output. Replay grows the viewport first, so this is indicative, not exact.
      const clip = anchoredClip({
        width: observed.metrics.width,
        contentHeight: observed.metrics.contentHeight,
        anchorY: observed.anchorY,
        aspectWidth: config.aspectWidth,
        aspectHeight: config.aspectHeight,
      });
      sink.event({
        kind: 'shot',
        crop: 'anchored',
        anchor,
        label,
        frame: { top: clip.y, height: clip.height, anchorY: observed.anchorY },
      });
      sink.note?.(`shot: frame anchored to "${label}"`);
      return;
    }

    if (observed.kind === 'change' && observed.action === 'upload') {
      sink.warn('a file upload was not recorded — the browser hides the real path; add that step by hand');
      return;
    }

    // Only a click needs attributing: a change is reported by the control that changed, so there is
    // no ancestor walk to second-guess.
    const chosen =
      observed.kind === 'click'
        ? attributeClick({ element: observed.element, rect: observed.rect }, observed.inner)
        : { element: observed.element, rect: observed.rect, scope: undefined };

    const found = await toLocator(page, chosen.element, chosen.rect, observed.url, chosen.scope);
    if (!found.locator) {
      const what = observed.kind === 'click' ? 'click' : observed.action;
      sink.skip(skipMessage(what, chosen.element, found.reason, observed.url));
      return;
    }
    const locator = found.locator;

    if (observed.kind === 'click') {
      sink.event({ kind: 'action', action: 'click', locator, label: fieldLabel(observed.element) });
      return;
    }

    if (observed.action === 'check' && !observed.checked) {
      sink.warn(
        `"${describeElement(observed.element)}" was unchecked — the spec has no uncheck action, ` +
          `so it was not recorded`,
      );
      return;
    }

    sink.event({
      kind: 'action',
      action: observed.action,
      locator,
      label: fieldLabel(observed.element),
      value: observed.element.value,
      secret: secretFor(observed.element, config.email),
    });
  };
};
