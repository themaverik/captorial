/**
 * Replay runner. Reads a validated canonical spec and drives a target app with Playwright using
 * semantic locators, capturing a screenshot (and an element-bounds sidecar) at each `shot`. The
 * only app-specific input is the spec itself plus generic config (base URL, output dir, auth state).
 *
 * The framing/storage is delegated to the transform layer (PageTransform); this runner never crops
 * or tiles directly. Playwright-coupled, so it is exercised against a live app rather than in unit
 * tests; the pure pieces (vars, locator tiers, url matching) are unit-tested separately.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { PageTransform } from '../transform/index.js';
import type { TileCaptureOptions } from '../transform/types.js';
import { ensureDir, isWithinRoot, log, sanitizeName, writeJson } from '../utils.js';
import type { CanonicalSpec, Shot, SpecLocator, Step, StepAction } from '../spec/types.js';
import { DEFAULT_VIEWPORT, fitViewport, probeDisplay, type Viewport } from './display.js';
import { describeLocator, resolveLocator } from './locator.js';
import { resolveValue, resolveVars } from './vars.js';
import { absoluteUrl, samePage, urlMatches } from './urlMatch.js';

export interface ReplayConfig {
  /** Where screenshots + bounds sidecars are written. */
  outputDir: string;
  /** Explicit capture viewport. Omitted: the canonical default, fitted to the display when headed. */
  viewport?: Viewport;
  deviceScaleFactor: number;
  /** Options handed to the transform layer for `fullpage` shots. */
  transform: TileCaptureOptions;
  /** Prefix for relative `page:` paths and the base for URL assertions. */
  baseUrl?: string;
  /** Playwright storage-state file for an authenticated session. */
  storageState?: string;
  headed?: boolean;
  slowMo?: number;
}

export interface ShotResult {
  id: string;
  files: string[];
  /** Bounds sidecar path, when a target element was resolved. */
  boundsFile?: string;
}

export interface ReplayResult {
  tutorial: string;
  shots: ShotResult[];
  warnings: string[];
}

/**
 * How long one action waits to become performable. Shorter than Playwright's 30s default: an element
 * that is present but never becomes actionable — a submit button left disabled because an earlier
 * step did not land — is a fact worth reporting quickly, not worth stalling half a minute on.
 */
const ACTION_TIMEOUT_MS = 10_000;

/** How often a URL assertion re-reads the address bar while waiting for the flow to land. */
const URL_POLL_INTERVAL_MS = 100;

/**
 * Perform one action against its resolved locator. Value references are already dereferenced.
 *
 * A failure warns and returns rather than ending the run, matching how an unresolved locator is
 * already handled: one flow usually has several problems, and aborting on the first reports one per
 * run. `at` and the locator description identify which step and element, since a bare count of
 * skipped actions is not something an author can act on.
 */
const runAction = async (
  page: Page,
  action: StepAction,
  resolvedVars: Record<string, string>,
  warnings: string[],
  at: string,
): Promise<void> => {
  const what = `${at} ${action.action} on ${describeLocator(action.locator)}`;
  const found = await resolveLocator(page, action.locator, (tier) => {
    if (tier === 'text') warnings.push(`${what}: fell through to the text tier`);
  });
  if (!found) {
    warnings.push(`${what}: no locator candidate matched — skipped`);
    return;
  }
  // Playwright is strict: acting on a locator that matches several elements throws rather than
  // picking one. A shot already resolves this with `.first()`; an action must too, or a page that
  // simply grew a second "Save" ends the step instead of reporting drift. Narrowing is deliberate
  // and always announced — silently acting on one of several is how a replay does the wrong thing
  // and still reports success.
  const matches = await found.locator.count().catch(() => 1);
  if (matches > 1 && action.locator.nth === undefined) {
    warnings.push(
      `${what}: matched ${matches} elements — acted on the first; add a testid or nth to disambiguate`,
    );
  }
  const locator = found.locator.first();
  const value = resolveValue(action.value, resolvedVars);
  const opts = { timeout: ACTION_TIMEOUT_MS };
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  try {
    switch (action.action) {
      case 'fill':
        await locator.fill(value ?? '', opts);
        break;
      case 'click':
        await locator.click(opts);
        break;
      case 'select':
        await locator.selectOption(value ?? '', opts);
        break;
      case 'check':
        await locator.check(opts);
        break;
      case 'press':
        await locator.press(value ?? 'Enter', opts);
        break;
      case 'upload':
        if (value) {
          await locator.setInputFiles(value.split(',').map((p) => p.trim()).filter(Boolean), opts);
        }
        break;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : 'action failed';
    warnings.push(`${what}: ${reason} — skipped`);
  }
};

/**
 * Navigate to a step's page.
 *
 * A navigation the app itself supersedes is reported by Chromium as a bare `ERR_ABORTED`, which says
 * nothing about why. Two of those are ordinary here and must not end the run: the previous step's
 * last action is a sign-in still completing, so the explicit visit collides with the app's own
 * navigation; or the app routes to this page itself, making the visit redundant. So on an abort,
 * let the page settle, and accept it if the app has already arrived — otherwise try once more before
 * giving up, and say where the browser actually ended up, since that is what identifies the cause.
 * The underlying message is kept to its first line and never carries a response body.
 */
const goToStepPage = async (
  page: Page,
  stepPage: string,
  warnings: string[],
  baseUrl?: string,
): Promise<void> => {
  const url = absoluteUrl(stepPage, baseUrl);
  const visit = (): Promise<unknown> => page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await visit();
    return;
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : 'navigation failed';
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    if (samePage(page.url(), url)) {
      warnings.push(`step page "${stepPage}": the app navigated here itself; the visit was redundant`);
      return;
    }
    try {
      await visit();
      warnings.push(`step page "${stepPage}": the first visit was aborted in flight and was retried`);
      return;
    } catch {
      throw new Error(
        `step page "${stepPage}": ${reason}. The browser is at ${page.url()}, and stayed there on a ` +
          `retry. An app-driven redirect aborts a navigation like this — the warnings above show ` +
          `which of the previous step's actions landed.`,
      );
    }
  }
};

/**
 * How long `expect.url` waits for the flow to land. Generous because the slowest case it covers is a
 * full sign-in: the app bounces to the identity provider, through a consent or password screen, and
 * back via a callback, none of which the runner drives.
 */
export const URL_SETTLE_TIMEOUT_MS = 20_000;

/**
 * Wait for the URL to match a glob. An `expect.url` describes where the flow *lands*, and landing
 * takes time — the click that causes it returns as soon as the click is delivered, long before the
 * navigation it triggers has resolved. Checking once reads the URL mid-flight, which for a sign-in
 * means reading the identity provider's address and calling the step failed.
 */
const waitForUrl = async (page: Page, pattern: string, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (urlMatches(page.url(), pattern)) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(URL_POLL_INTERVAL_MS).catch(() => undefined);
  }
};

/** Assert a step's `expect` block: URL glob and a single visible element. */
const runExpect = async (
  page: Page,
  step: Step,
  warnings: string[],
): Promise<void> => {
  const expect = step.expect;
  if (!expect) return;
  if (expect.url && !(await waitForUrl(page, expect.url, URL_SETTLE_TIMEOUT_MS))) {
    warnings.push(
      `expect.url "${expect.url}" did not match "${page.url()}" within ` +
        `${URL_SETTLE_TIMEOUT_MS / 1000}s — the flow did not land where the recording did`,
    );
  }
  if (expect.visible) {
    const found = await resolveLocator(page, expect.visible);
    const visible = found ? await found.locator.first().isVisible().catch(() => false) : false;
    if (!visible) warnings.push(`expect.visible element not visible`);
  }
};

/** Read the target element's bounds and the device pixel ratio into a sidecar next to the PNG. */
const writeBoundsSidecar = async (
  page: Page,
  target: SpecLocator,
  dir: string,
  shotId: string,
): Promise<string | undefined> => {
  const found = await resolveLocator(page, target);
  if (!found) return undefined;
  const box = await found.locator.first().boundingBox().catch(() => null);
  if (!box) return undefined;
  const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 1);
  const file = path.join(dir, `${shotId}.bounds.json`);
  writeJson(file, { shotId, tier: found.tier, boundingBox: box, devicePixelRatio: dpr });
  return file;
};

/**
 * Top offset of an anchored shot's anchor element, or null when it cannot be resolved — in which
 * case the transform falls back to the top of the content rather than failing the run. Called back
 * from the transform *after* it has grown the viewport and reset scroll, since both move the anchor.
 */
const measureAnchorY = async (
  page: Page,
  anchor: SpecLocator,
  warnings: string[],
): Promise<number | null> => {
  const found = await resolveLocator(page, anchor);
  const box = found ? await found.locator.first().boundingBox().catch(() => null) : null;
  if (!box) {
    warnings.push('anchored shot: anchor did not resolve — framed from the top of the content');
    return null;
  }
  return box.y;
};

/** Capture one shot per its crop mode, plus the bounds sidecar when a target is given. */
const runShot = async (
  page: Page,
  transform: PageTransform,
  shot: Shot,
  dir: string,
  warnings: string[],
): Promise<ShotResult> => {
  ensureDir(dir);
  // The shot id becomes a filename; sanitise it so a recorded/authored id can never traverse.
  const id = sanitizeName(shot.id) || 'shot';
  let files: string[];
  if (shot.crop === 'fullpage') {
    files = await transform.captureWebpageTiles(dir, id);
  } else if (shot.crop === 'anchored' && shot.anchor) {
    const anchor = shot.anchor;
    files = await transform.captureAnchoredFrame(dir, id, () => measureAnchorY(page, anchor, warnings));
  } else if (shot.crop === 'element' && shot.target) {
    const found = await resolveLocator(page, shot.target);
    const dest = path.join(dir, `${id}.png`);
    if (found) await found.locator.first().screenshot({ path: dest });
    else await page.screenshot({ path: dest });
    files = [dest];
  } else {
    const dest = path.join(dir, `${id}.png`);
    await page.screenshot({ path: dest });
    files = [dest];
  }
  const boundsFile = shot.target ? await writeBoundsSidecar(page, shot.target, dir, id) : undefined;
  return { id, files, boundsFile };
};

/**
 * The viewport to capture at. An explicit config value wins outright. Otherwise headless keeps the
 * canonical size so output is identical on every machine, and headed fits the real display — the
 * window has to show the page for a headed run to be worth watching.
 */
const resolveViewport = async (browser: Browser, config: ReplayConfig): Promise<Viewport> => {
  if (config.viewport) return config.viewport;
  if (!config.headed) return DEFAULT_VIEWPORT;
  const fitted = fitViewport(DEFAULT_VIEWPORT, await probeDisplay(browser));
  if (fitted.width !== DEFAULT_VIEWPORT.width || fitted.height !== DEFAULT_VIEWPORT.height) {
    log.info(
      `headed: display fits ${fitted.width}x${fitted.height}, not ` +
        `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height} — set VIEWPORT to override`,
    );
  }
  return fitted;
};

export const replaySpec = async (
  spec: CanonicalSpec,
  config: ReplayConfig,
  env: Record<string, string | undefined> = process.env,
): Promise<ReplayResult> => {
  const resolvedVars = resolveVars(spec.vars, { env, now: new Date() });
  const warnings: string[] = [];
  const shots: ShotResult[] = [];
  // Sanitise the tutorial slug and confirm the shot directory stays under the output root, so a
  // hostile or recorded name cannot write outside it.
  const tutorial = sanitizeName(spec.tutorial) || 'tutorial';
  const shotDir = path.join(config.outputDir, tutorial);
  if (!isWithinRoot(config.outputDir, shotDir)) {
    throw new Error(`tutorial "${spec.tutorial}" resolves outside the output directory`);
  }

  // A configured-but-absent session file is the difference between replaying signed in and replaying
  // signed out, and silently ignoring it defers that discovery to whatever the app does to an
  // unauthenticated visit — typically a redirect that aborts a later navigation.
  if (config.storageState && !fs.existsSync(config.storageState)) {
    throw new Error(
      `STORAGE_STATE "${config.storageState}" does not exist. Point it at a saved session, or ` +
        `unset it to sign in through the app.`,
    );
  }

  const browser: Browser = await chromium.launch({
    headless: !config.headed,
    slowMo: config.slowMo,
    args: config.headed ? ['--start-maximized'] : [],
  });
  const viewport = await resolveViewport(browser, config);
  const context = await browser.newContext({
    storageState: config.storageState,
    viewport,
    deviceScaleFactor: config.deviceScaleFactor,
  });
  const page = await context.newPage();
  const transform = new PageTransform(page, config.transform);

  try {
    for (const [index, step] of spec.steps.entries()) {
      if (step.page) await goToStepPage(page, step.page, warnings, config.baseUrl);
      await runExpect(page, step, warnings);
      const actions = step.do ?? [];
      for (const [i, action] of actions.entries()) {
        await runAction(page, action, resolvedVars, warnings, `steps[${index}].do[${i}]`);
      }
      if (step.shot) {
        const result = await runShot(page, transform, step.shot, shotDir, warnings);
        shots.push(result);
        log.step(`shot ${result.id} -> ${result.files.map((f) => path.basename(f)).join(', ')}`);
      }
    }
  } finally {
    await browser.close();
    // In the finally, not after it: a step that throws is exactly when the warnings explaining why
    // matter most, and returning them only on success threw away the diagnosis with the run.
    for (const warning of warnings) log.warn(warning);
  }

  return { tutorial: spec.tutorial, shots, warnings };
};
