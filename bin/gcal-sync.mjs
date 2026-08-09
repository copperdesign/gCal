#!/usr/bin/env node
/**
 * @docs ../README.md#nightly-sync-with-github-actions
 *
 * gcal-sync — fetch a calendar, normalize it, write the JSON artifact.
 *
 *   GCAL_API_KEY=… npx gcal-sync [--config gcal.config.json] [--strict]
 *
 * The whole job is: data in, one deterministic file out. It deliberately
 * does NOT render HTML — markup is per-site (date-pill rows on one,
 * cards on another), so each consumer's build calls
 * `renderEventsToString` with its own template. Same seam the browser
 * renderer already draws.
 *
 * NO BANNER ON THIS FILE, deliberately. The `/*! gCal — vX.Y.Z` header
 * on src/*.js is a license notice meant to survive minification, and
 * both `stamp-banners.mjs` and the CI check only look at `src/`. A
 * banner here would go stale silently, which is worse than not having
 * one.
 *
 * FAIL-SOFT IS THE POINT (see `run`)
 * A transient Google outage must not fail the consumer's whole deploy.
 * The default is to log, leave whatever artifact is already committed
 * untouched, and exit 0 — yesterday's calendar is a far better outcome
 * than a red build or a blank page. `--strict` is there for consumers
 * who genuinely want the failure to propagate.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fetchAllEvents,
  normalizeEvents,
  serializeArtifact,
  startOfDay,
} from '../src/node.js';

const USAGE = `gcal-sync — fetch a Google Calendar into a deterministic JSON artifact.

Usage:
  gcal-sync [options]

Options:
  --config <path>   Config file (default: gcal.config.json)
  --strict          Exit non-zero when the fetch fails (default: exit 0,
                    keeping the existing artifact — see below)
  -h, --help        Show this message

Environment:
  GCAL_API_KEY      Required. Server-side Google API key, restricted to
                    the Calendar API. Never put it in the config file —
                    that file gets committed.

Config file (strict JSON — no comments):
  {
    "calendarId": "you@example.com",
    "timeZone":   "Europe/Berlin",
    "out":        "src/content/kalender.json"
  }

  Optional keys: "maxResults" (page size, default 100) and "timeMax"
  (ISO 8601). "apiKey" is NOT a config key and is rejected if present.

Exit codes:
  0  wrote the artifact, or it was already up to date, or the fetch
     failed and the existing artifact was left in place
  1  configuration error (bad flags, missing/malformed config, unwritable
     output) — or any fetch failure when --strict is set

A configuration error always exits 1, with or without --strict: it will
not fix itself tomorrow, so failing quietly would just hide it.`;

/**
 * Parse argv. Throws on anything unrecognized — an unknown flag is a
 * config error, not a transient one, so it is never covered by the
 * fail-soft rule.
 */
export function parseArgs(argv = []) {
  const opts = { config: 'gcal.config.json', strict: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--strict') {
      opts.strict = true;
    } else if (arg === '--config') {
      const value = argv[++i];
      if (!value) throw new Error('--config needs a path');
      opts.config = value;
    } else if (arg.startsWith('--config=')) {
      opts.config = arg.slice('--config='.length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

/**
 * Read and validate the config.
 *
 * `timeZone` is required rather than defaulting to UTC. A default would
 * be silently wrong for every calendar not actually in UTC — a job at
 * 01:00 UTC is already 03:00 in Berlin, and a UTC-floored `timeMin`
 * would drop events that are still happening locally today. Better to
 * ask once than to be quietly wrong nightly.
 */
export async function loadConfig(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`cannot read config file: ${path}`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config file is not valid JSON: ${path} (${err.message})`);
  }

  for (const key of ['calendarId', 'timeZone', 'out']) {
    if (!config[key]) throw new Error(`config is missing "${key}": ${path}`);
  }
  if (config.apiKey) {
    // Loud, not a warning: a key in a committed file is the exact
    // mistake this tool exists to make hard.
    throw new Error(
      'config must not contain "apiKey" — it gets committed. Use the GCAL_API_KEY environment variable.',
    );
  }
  return config;
}

/**
 * The whole sync, as a function, so tests can inject a fetcher and a
 * clock instead of reaching the network or depending on today's date.
 * Returns the process exit code rather than calling process.exit, so a
 * caller can decide what to do with it.
 */
export async function run(argv = [], deps = {}) {
  const {
    env = process.env,
    out: stdout = console.log,
    err: stderr = console.error,
    fetchEvents = fetchAllEvents,
    now = new Date(),
  } = deps;

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr(`gcal-sync: ${err.message}`);
    stderr(USAGE);
    return 1;
  }

  if (opts.help) {
    stdout(USAGE);
    return 0;
  }

  let config;
  try {
    config = await loadConfig(opts.config);
  } catch (err) {
    stderr(`gcal-sync: ${err.message}`);
    return 1;
  }

  const apiKey = env.GCAL_API_KEY;
  if (!apiKey) {
    stderr('gcal-sync: GCAL_API_KEY is not set');
    return 1;
  }

  const outPath = resolve(config.out);
  // Read first: needed both to skip an unchanged write and to know
  // whether a failed fetch has anything to fall back on.
  const existing = await readIfPresent(outPath);

  let items;
  try {
    items = await fetchEvents({
      calendarId: config.calendarId,
      apiKey,
      maxResults: config.maxResults,
      timeMax: config.timeMax,
      // Floored to the start of the day in the configured zone. A raw
      // `new Date().toISOString()` here would change every run and make
      // the artifact churn for no reason.
      timeMin: startOfDay(config.timeZone, now),
    });
  } catch (err) {
    if (opts.strict) {
      stderr(`gcal-sync: fetch failed — ${err.message}`);
      return 1;
    }
    // Fail-soft. Say plainly which of the two situations this is: an
    // existing artifact means the site keeps yesterday's calendar and
    // nobody needs to act tonight; no artifact means the consumer's
    // build is about to hit a missing file, and that deserves a much
    // louder line in the log.
    stderr(`gcal-sync: fetch failed — ${err.message}`);
    if (existing === null) {
      stderr('gcal-sync: no existing artifact to fall back on — nothing was written.');
    } else {
      stderr(`gcal-sync: keeping the existing ${config.out} unchanged.`);
    }
    return 0;
  }

  const next = serializeArtifact(normalizeEvents(items));

  if (next === existing) {
    // The common case on a quiet night. Not writing at all keeps mtime
    // stable and keeps `git diff --quiet` meaningful for the caller.
    stdout(`gcal-sync: ${config.out} already up to date (${items.length} events)`);
    return 0;
  }

  try {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, next);
  } catch (err) {
    // A write failure is environmental, not transient — a wrong path or
    // a read-only checkout won't resolve itself tomorrow.
    stderr(`gcal-sync: could not write ${config.out} — ${err.message}`);
    return 1;
  }

  stdout(`gcal-sync: wrote ${config.out} (${items.length} events)`);
  return 0;
}

async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/* Only self-invoke when executed directly, so tests can import `run` and
   drive it with an injected fetcher.

   realpathSync is LOAD-BEARING, not defensive. npm installs a bin as a
   SYMLINK (node_modules/.bin/gcal-sync -> ../@copperdesign/gcal/bin/…),
   so under `npx gcal-sync` — the only way this is ever invoked in
   production — argv[1] is the link while import.meta.url is the real
   file. A plain path comparison silently fails to match, and the CLI
   exits 0 having done absolutely nothing. Caught by installing a packed
   tarball into a scratch consumer; running ./bin/gcal-sync.mjs directly
   during development never reproduces it. */
if (isMain(process.argv[1], import.meta.url)) {
  process.exit(await run(process.argv.slice(2)));
}

export function isMain(invokedPath, moduleUrl) {
  if (!invokedPath) return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return realpathSync(invokedPath) === realpathSync(self);
  } catch {
    // argv[1] doesn't exist on disk (an eval'd or piped entry point).
    // Fall back to the plain comparison rather than throwing at import.
    return resolve(invokedPath) === resolve(self);
  }
}
