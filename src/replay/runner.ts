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
import { resolveLocator } from './locator.js';
import { resolveValue, resolveVars } from './vars.js';
import { urlMatches } from './urlMatch.js';

export interface ReplayConfig {
  /** Where screenshots + bounds sidecars are written. */
  outputDir: string;
  viewport: { width: number; height: number };
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

const absoluteUrl = (pagePath: string, baseUrl?: string): string => {
  if (/^https?:\/\//i.test(pagePath)) return pagePath;
  if (!baseUrl) return pagePath;
  return `${baseUrl.replace(/\/+$/, '')}/${pagePath.replace(/^\/+/, '')}`;
};

/** Perform one action against its resolved locator. Value references are already dereferenced. */
const runAction = async (
  page: Page,
  action: StepAction,
  resolvedVars: Record<string, string>,
  warnings: string[],
): Promise<void> => {
  const found = await resolveLocator(page, action.locator, (tier) => {
    if (tier === 'text') warnings.push(`action "${action.action}" fell through to the text tier`);
  });
  if (!found) {
    warnings.push(`action "${action.action}": no locator candidate matched — skipped`);
    return;
  }
  const { locator } = found;
  const value = resolveValue(action.value, resolvedVars);
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  switch (action.action) {
    case 'fill':
      await locator.fill(value ?? '');
      break;
    case 'click':
      await locator.click();
      break;
    case 'select':
      await locator.selectOption(value ?? '');
      break;
    case 'check':
      await locator.check();
      break;
    case 'press':
      await locator.press(value ?? 'Enter');
      break;
    case 'upload':
      if (value) await locator.setInputFiles(value.split(',').map((p) => p.trim()).filter(Boolean));
      break;
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
  if (expect.url && !urlMatches(page.url(), expect.url)) {
    warnings.push(`expect.url "${expect.url}" did not match "${page.url()}"`);
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

/** Capture one shot per its crop mode, plus the bounds sidecar when a target is given. */
const runShot = async (
  page: Page,
  transform: PageTransform,
  shot: Shot,
  dir: string,
): Promise<ShotResult> => {
  ensureDir(dir);
  // The shot id becomes a filename; sanitise it so a recorded/authored id can never traverse.
  const id = sanitizeName(shot.id) || 'shot';
  let files: string[];
  if (shot.crop === 'fullpage') {
    files = await transform.captureWebpageTiles(dir, id);
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

  const browser: Browser = await chromium.launch({ headless: !config.headed, slowMo: config.slowMo });
  const context = await browser.newContext({
    storageState: config.storageState && fs.existsSync(config.storageState) ? config.storageState : undefined,
    viewport: config.viewport,
    deviceScaleFactor: config.deviceScaleFactor,
  });
  const page = await context.newPage();
  const transform = new PageTransform(page, config.transform);

  try {
    for (const step of spec.steps) {
      if (step.page) {
        await page.goto(absoluteUrl(step.page, config.baseUrl), { waitUntil: 'domcontentloaded' });
      }
      await runExpect(page, step, warnings);
      for (const action of step.do ?? []) await runAction(page, action, resolvedVars, warnings);
      if (step.shot) {
        const result = await runShot(page, transform, step.shot, shotDir);
        shots.push(result);
        log.step(`shot ${result.id} -> ${result.files.map((f) => path.basename(f)).join(', ')}`);
      }
    }
  } finally {
    await browser.close();
  }

  for (const warning of warnings) log.warn(warning);
  return { tutorial: spec.tutorial, shots, warnings };
};
