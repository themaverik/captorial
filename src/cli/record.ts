/**
 * Recorder CLI: perform a flow once, review it, and write a canonical spec.
 *
 *   npm run record
 *
 * 1. Asks for the base URL and the credentials the flow signs in with.
 * 2. Opens the app headed. You drive it; Ctrl+Shift+S marks a frame anchored to the element at the
 *    top of the view, Ctrl+Shift+F marks a whole-page shot auto-tiled into overlapping frames.
 * 3. Derives a spec from what you did, naming each field's variable after its label and defaulting
 *    it to the value you typed.
 * 4. Prints the replayable steps for confirmation.
 * 5. On confirmation, writes specs/<tutorial>.yaml.
 *
 * Credentials are held in memory for the session only. They become env-sourced vars in the spec,
 * never literals, and a password's value never leaves the browser at all.
 *
 * Generic env defaults (same keys the replay CLI reads): BASE_URL, STORAGE_STATE, SLOWMO.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { serializeSpec } from '../spec/serialize.js';
import { parseSpec } from '../spec/validate.js';
import { renderSpec, requiredEnvVars } from '../record/render.js';
import { runSession } from '../record/session.js';
import { SECRET_ENV, buildSpec } from '../record/stepBuilder.js';
import { ensureDir, isWithinRoot, log, sanitizeName } from '../utils.js';

/** Matches the replay CLI, so a frame recorded here is framed the same way on replay. */
const VIEWPORT = { width: 1920, height: 1080 };
const ASPECT = { width: 16, height: 9 };
const SPECS_DIR = path.resolve('specs');

const isYes = (answer: string): boolean => /^y(es)?$/i.test(answer.trim());

/** Filesystem-safe, lowercase slug for the spec filename and the tutorial id. */
const slugify = (value: string): string =>
  sanitizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tutorial';

/**
 * Prompts on a writable that can be muted, so a password is never echoed to the terminal or into a
 * scrollback buffer.
 */
const createPrompt = () => {
  const state = { muted: false };
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!state.muted) process.stdout.write(chunk as Buffer);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });

  const ask = async (question: string, fallback = ''): Promise<string> => {
    const suffix = fallback ? ` [${fallback}]` : '';
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || fallback;
  };

  const askSecret = async (question: string): Promise<string> => {
    // question() writes its prompt before yielding, so muting straight after hides only the echo.
    const pending = rl.question(`${question}: `);
    state.muted = true;
    const answer = await pending;
    state.muted = false;
    process.stdout.write('\n');
    return answer;
  };

  const waitForEnter = async (question: string): Promise<void> => {
    await rl.question(question);
  };

  return { ask, askSecret, waitForEnter, close: (): void => rl.close() };
};

const run = async (): Promise<void> => {
  const prompt = createPrompt();
  try {
    log.info('Record a tutorial flow. Values in [brackets] are defaults — press Enter to accept.');
    const baseUrl = await prompt.ask('Base URL', process.env.BASE_URL || '');
    if (!baseUrl) throw new Error('A base URL is required.');
    const email = await prompt.ask('Email');
    const password = await prompt.askSecret('Password');
    const tutorial = await prompt.ask('Tutorial name', 'tutorial');

    const slug = slugify(tutorial);
    const dest = path.join(SPECS_DIR, `${slug}.yaml`);
    // The tutorial name is user input that becomes a path; confirm it cannot escape the specs dir.
    if (!isWithinRoot(SPECS_DIR, dest)) {
      throw new Error(`tutorial "${tutorial}" resolves outside the specs directory`);
    }

    const session = await runSession(
      {
        baseUrl,
        email,
        password,
        viewport: VIEWPORT,
        aspectWidth: ASPECT.width,
        aspectHeight: ASPECT.height,
        storageState: process.env.STORAGE_STATE,
        slowMo: Number(process.env.SLOWMO || 0),
      },
      () => prompt.waitForEnter('\nPress Enter here when the flow is done, or just close the browser.\n'),
    );

    const built = buildSpec(slug, session.events);
    const yamlText = serializeSpec(built.spec);
    const validation = parseSpec(yamlText);

    log.plain('');
    log.info(
      `Recorded "${built.spec.tutorial}": ${built.spec.steps.length} step(s), ` +
        `${Object.keys(built.spec.vars).length} variable(s).`,
    );
    log.plain('');
    for (const line of renderSpec(built.spec)) log.plain(line);
    log.plain('');

    const envVars = requiredEnvVars(built.spec);
    if (envVars.length) log.info(`Replay will read these from the environment: ${envVars.join(', ')}`);
    for (const warning of [...session.warnings, ...built.warnings]) log.warn(warning);

    if (!validation.ok) {
      log.error(`This flow did not produce a valid spec:\n- ${validation.errors.join('\n- ')}`);
      process.exitCode = 1;
      return;
    }

    if (!isYes(await prompt.ask('\nWrite this spec? [y/N]'))) {
      log.info('Discarded; nothing written.');
      return;
    }
    if (fs.existsSync(dest)) {
      const relative = path.relative(process.cwd(), dest);
      if (!isYes(await prompt.ask(`${relative} already exists. Overwrite? [y/N]`))) {
        log.info('Kept the existing spec; nothing written.');
        return;
      }
    }

    ensureDir(SPECS_DIR);
    fs.writeFileSync(dest, yamlText, 'utf8');
    const relative = path.relative(process.cwd(), dest).replace(/\\/g, '/');
    log.info(`Wrote ${relative}`);
    if (envVars.length) {
      log.info(
        `Set ${envVars.join(' and ')} in your environment (.env is gitignored), then: ` +
          `npm run replay -- ${relative}`,
      );
      log.info(
        `${SECRET_ENV.email} is the address you entered; ${SECRET_ENV.password} is its password. ` +
          `Neither was written to the spec.`,
      );
    } else {
      log.info(`Replay it with: npm run replay -- ${relative}`);
    }
  } finally {
    prompt.close();
  }
};

run().catch((error) => {
  log.error(String(error));
  process.exit(1);
});
