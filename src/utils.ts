/** Small shared helpers: filesystem-safe names, logging, ordering. */

import fs from 'node:fs';
import path from 'node:path';

/** Make a string safe for use as a folder/file name (keeps spaces, strips reserved chars). */
export const sanitizeName = (name: string): string =>
  name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Zero-padded 2-digit order prefix. */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Turn a raw app-version string into a tidy folder name (shortens bare git SHAs). Shared by the
 *  capture engine (naming the folder) and the captions pass (matching APP_VERSION to it). */
export const formatVersionFolder = (version: string): string => {
  const clean = sanitizeName(version);
  if (/^[0-9a-f]{16,}$/i.test(clean)) return clean.slice(0, 12); // bare git SHA → short form
  return clean || 'unknown-version';
};

/** Case-insensitive alphabetical sort by a key. */
export const byName = <T>(key: (item: T) => string) => (a: T, b: T): number =>
  key(a).localeCompare(key(b), 'en', { sensitivity: 'base' });

export const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

export const writeJson = (file: string, data: unknown): void => {
  ensureDir(path.dirname(file)); // create the parent dir (e.g. a fresh OUTPUT_DIR) if needed
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
};

export const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

/* eslint-disable no-console */
export const log = {
  info: (msg: string): void => console.log(`[info] ${msg}`),
  step: (msg: string): void => console.log(`  -> ${msg}`),
  warn: (msg: string): void => console.warn(`[warn] ${msg}`),
  error: (msg: string): void => console.error(`[error] ${msg}`),
};
