#!/usr/bin/env node
/**
 * @docs ../docs/scripts.md
 *
 * Rewrite the `/*! gCal — vX.Y.Z - YYYY-MM-DD` banner at the top of every
 * `src/*.js` so it matches the version in `package.json` plus today's date.
 *
 * Run automatically by `npm version <bump>` via the `version` script in
 * `package.json` — sits between the package.json bump and the version
 * commit, so the rewritten banners ride along in the same commit/tag.
 *
 * Also safe to run by hand: idempotent against unchanged inputs.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here   = dirname(fileURLToPath(import.meta.url));
const root   = join(here, '..');
const srcDir = join(root, 'src');
const pkg    = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const today  = new Date().toISOString().slice(0, 10);
const newFirstLine = `/*! gCal — v${pkg.version} - ${today}`;

// Anchored to BOF — only ever touches the first line, never an in-body
// comment that happens to look like a banner.
const bannerRe = /^\/\*! gCal — v[\d.]+ - \d{4}-\d{2}-\d{2}/;

let changed = 0;
let skipped = 0;
for (const name of readdirSync(srcDir)) {
  if (!name.endsWith('.js')) continue;
  const path = join(srcDir, name);
  const src  = readFileSync(path, 'utf8');
  if (!bannerRe.test(src)) {
    console.warn(`stamp-banners: ${name} has no banner — skipping`);
    skipped++;
    continue;
  }
  const next = src.replace(bannerRe, newFirstLine);
  if (next === src) continue;
  writeFileSync(path, next);
  changed++;
}

console.log(
  `stamp-banners: v${pkg.version} (${today}) — ${changed} rewritten, ${skipped} skipped`,
);
