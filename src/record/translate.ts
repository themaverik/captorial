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
  /** An interaction with no resolvable locator — counted, not warned, to avoid flooding the log. */
  skip: () => void;
  note?: (message: string) => void;
}

/** How the user would refer to this element. */
export const describeElement = (element: ElementDescriptor): string =>
  fieldLabel(element) ?? element.text ?? element.tag;

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
  ): Promise<SpecLocator | null> => {
    const candidate = locatorFor(element);
    if (!hasCandidate(candidate)) return null;
    const verified = await verifyLocator(page, candidate, rect);
    if (!verified) return null;
    if (verified.ambiguous) {
      sink.warn(
        `"${describeElement(element)}" matched several elements and was recorded by position — ` +
          `add a data-testid to make it stable`,
      );
    }
    return verified.locator;
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
      const anchor = await toLocator(page, observed.element, observed.rect);
      if (!anchor) {
        sink.warn(`a frame anchored to "${describeElement(observed.element)}" could not be located — skipped`);
        return;
      }
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

    const locator = await toLocator(page, observed.element, observed.rect);
    if (!locator) {
      sink.skip();
      return;
    }

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
