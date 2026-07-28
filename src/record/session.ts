/**
 * Recording session: opens a headed browser, streams observed interactions through the translator,
 * and records page boundaries — the lifecycle only. The judgement about what an interaction means
 * lives in `translate.ts`, and the assembly into a spec in `stepBuilder.ts`.
 *
 * Playwright-coupled, so it is exercised against a real app rather than in unit tests.
 */

import fs from 'node:fs';
import { chromium } from 'playwright';
import { log } from '../utils.js';
import { isAuthNavigation } from './authNav.js';
import { installObserver, SHOT_KEYS } from './observer.js';
import type { RecordedEvent } from './stepBuilder.js';
import { createTranslator } from './translate.js';

export interface RecordConfig {
  baseUrl: string;
  /** Credentials the flow signs in with. Held in memory only; never written to a spec. */
  email: string;
  password: string;
  aspectWidth: number;
  aspectHeight: number;
  /** Playwright storage-state file for an already-authenticated session. */
  storageState?: string;
  slowMo?: number;
}

export interface SessionResult {
  events: RecordedEvent[];
  warnings: string[];
}

/**
 * Path of a URL relative to the base. Off-origin navigation is kept absolute so replay cannot
 * silently rebase it onto the target app.
 */
export const relativePath = (url: string, baseUrl: string): string | null => {
  if (!/^https?:/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(baseUrl).origin) return parsed.href;
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return null;
  }
};

/**
 * Open the app and record until `waitForFinish` resolves or the user closes the browser. Returns the
 * raw event stream; turning it into a spec is the step builder's job.
 */
export const runSession = async (
  config: RecordConfig,
  waitForFinish: () => Promise<void>,
): Promise<SessionResult> => {
  const events: RecordedEvent[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const translate = createTranslator(
    { email: config.email, aspectWidth: config.aspectWidth, aspectHeight: config.aspectHeight },
    {
      event: (event) => events.push(event),
      warn: (message) => {
        // The same drift shows up on every interaction with an element; say it once.
        if (seen.has(message)) return;
        seen.add(message);
        warnings.push(message);
      },
      skip: () => {
        skipped += 1;
      },
      note: (message) => log.step(message),
    },
  );

  // The recorder is driven by hand, so the viewport must be the window the operator can actually
  // reach. A fixed viewport larger than the screen lays the page out beyond the window with no
  // scrollbars, putting controls out of reach. `null` tracks the maximised window instead; replay
  // sets its own capture viewport and re-measures anchors live, so nothing here has to match it.
  const browser = await chromium.launch({
    headless: false,
    slowMo: config.slowMo,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({
    viewport: null,
    storageState:
      config.storageState && fs.existsSync(config.storageState) ? config.storageState : undefined,
  });
  await installObserver(context, translate);

  const page = await context.newPage();
  let droppedAuthHops = 0;
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const path = relativePath(frame.url(), config.baseUrl);
    if (!path) return;
    // A hop in a sign-in exchange is bound to this one attempt and can never be replayed, and its
    // query carries a credential. Drop it here so it never reaches the event stream or the spec:
    // replay visits the app and lets it start a fresh sign-in instead.
    if (isAuthNavigation(path)) {
      droppedAuthHops += 1;
      return;
    }
    events.push({ kind: 'navigate', path });
  });

  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
  log.info('Recording. Drive the app in the browser window.');
  log.info(`  ${SHOT_KEYS.anchored}  frame anchored to the element at the top of the view`);
  log.info(`  ${SHOT_KEYS.fullpage}  whole page, auto-tiled into overlapping frames`);

  // Finish on either signal: enter pressed here, or the browser window closed.
  await new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve());
    waitForFinish().then(resolve, () => resolve());
  });
  if (browser.isConnected()) await browser.close();

  if (droppedAuthHops) {
    log.step(
      `${droppedAuthHops} sign-in redirect(s) were not recorded — replay signs in through the app`,
    );
  }
  if (skipped) {
    warnings.push(
      `${skipped} interaction(s) were skipped: no role+name, data-testid, or short text to locate them by`,
    );
  }
  return { events, warnings };
};
