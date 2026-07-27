/**
 * Replay CLI: validate a canonical spec, then drive the target app with it.
 *
 *   npm run replay -- specs/example-login.yaml
 *
 * Config is read from generic environment variables only (no product-specific keys):
 *   BASE_URL            base for relative `page:` paths and URL assertions
 *   OUTPUT_DIR          where screenshots + bounds sidecars are written (default ./replay-output)
 *   STORAGE_STATE       Playwright storage-state file for an authenticated session (optional)
 *   DEVICE_SCALE_FACTOR screenshot DPI multiplier (default 1)
 *   CROP_169            crop full-page shots to 16:9 tiles (default true)
 *   HEADED, SLOWMO      run headed / slow down actions for debugging
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseSpec } from '../spec/validate.js';
import { replaySpec, type ReplayConfig } from '../replay/index.js';
import { log } from '../utils.js';

const VIEWPORT = { width: 1920, height: 1080 };

const buildConfig = (): ReplayConfig => ({
  outputDir: path.resolve(process.env.OUTPUT_DIR || 'replay-output'),
  viewport: VIEWPORT,
  deviceScaleFactor: Math.max(1, Number(process.env.DEVICE_SCALE_FACTOR || 1)),
  baseUrl: process.env.BASE_URL,
  storageState: process.env.STORAGE_STATE,
  headed: process.env.HEADED === 'true',
  slowMo: Number(process.env.SLOWMO || 0),
  transform: {
    cropTo169: process.env.CROP_169 !== 'false',
    aspectWidth: 16,
    aspectHeight: 9,
    maxViewportHeightPx: 8000,
    capturePaddingPx: 32,
  },
});

const run = async (): Promise<void> => {
  const specPath = process.argv[2];
  if (!specPath) throw new Error('Usage: npm run replay -- <spec.yaml>');
  if (!fs.existsSync(specPath)) throw new Error(`Spec not found: ${specPath}`);

  const result = parseSpec(fs.readFileSync(specPath, 'utf8'));
  if (!result.ok) {
    throw new Error(`Invalid spec ${specPath}:\n- ${result.errors.join('\n- ')}`);
  }

  const config = buildConfig();
  log.info(`Replaying "${result.spec.tutorial}" (${result.spec.steps.length} steps) -> ${config.outputDir}`);
  const outcome = await replaySpec(result.spec, config);
  log.info(`Captured ${outcome.shots.length} shot(s); ${outcome.warnings.length} warning(s).`);
};

run().catch((error) => {
  log.error(String(error));
  process.exit(1);
});
