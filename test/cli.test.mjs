/**
 * @docs ../README.md#nightly-sync-with-github-actions
 *
 * Tests for the `gcal-sync` CLI.
 *
 * Nothing here touches the network: `run()` takes an injected fetcher,
 * which is why the CLI exposes it at all. Stubbing global `fetch` would
 * have worked too, but a stub silently stops matching the real call
 * signature the moment it changes, and then the test passes while
 * proving nothing.
 *
 * The behaviours worth guarding are the ones that only show up at 01:00
 * on someone else's server: fail-soft on a bad night, no write when
 * nothing changed, and a loud exit for anything that won't fix itself
 * by tomorrow.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, parseArgs, loadConfig, isMain } from '../bin/gcal-sync.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(join(here, 'fixtures', 'events.json'), 'utf8'));

// Fixed clock — startOfDay feeds it into timeMin, and a test that
// depends on today's date fails mysteriously on a DST weekend.
const NOW = new Date('2026-08-09T01:00:00Z');
const ENV = { GCAL_API_KEY: 'test-key' };

/** A scratch directory with a config file, torn down after each test. */
async function scratch(configOverrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gcal-sync-'));
  const out = join(dir, 'data', 'kalender.json');
  const configPath = join(dir, 'gcal.config.json');
  await writeFile(configPath, JSON.stringify({
    calendarId: 'test@example.com',
    timeZone: 'Europe/Berlin',
    out,
    ...configOverrides,
  }, null, 2));
  return { dir, out, configPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// Collects output instead of printing it, so a passing run is quiet and
// a failing one can assert on what was said.
function recorder() {
  const out = [];
  const err = [];
  return { out: (m) => out.push(m), err: (m) => err.push(m), stdout: out, stderr: err };
}

const ok = () => async () => fixture;
const boom = (message = 'gCal: API key not valid') => async () => { throw new Error(message); };

/* ── the happy path ──────────────────────────────────────────────────── */

test('writes the artifact, creating the output directory', async () => {
  const s = await scratch();
  const log = recorder();
  try {
    const code = await run(['--config', s.configPath], { env: ENV, now: NOW, fetchEvents: ok(), ...log });
    assert.equal(code, 0);
    const written = JSON.parse(await readFile(s.out, 'utf8'));
    assert.equal(written.schemaVersion, 1);
    assert.equal(written.events.length, fixture.length);
    assert.ok(log.stdout.join('\n').includes('wrote'));
  } finally {
    await s.cleanup();
  }
});

test('passes a day-floored timeMin, not the current instant', async () => {
  // The property that keeps the artifact stable: a drifting timeMin
  // makes events near the boundary flicker in and out for no reason.
  const s = await scratch();
  let seen;
  try {
    await run(['--config', s.configPath], {
      env: ENV, now: NOW, ...recorder(),
      fetchEvents: async (config) => { seen = config; return fixture; },
    });
    assert.equal(seen.timeMin, '2026-08-08T22:00:00.000Z');
    assert.equal(seen.apiKey, 'test-key');
    assert.equal(seen.calendarId, 'test@example.com');
  } finally {
    await s.cleanup();
  }
});

test('an empty calendar still writes an artifact', async () => {
  // "No file" and "no events" have to stay distinguishable — the
  // fail-soft path depends on telling them apart.
  const s = await scratch();
  try {
    const code = await run(['--config', s.configPath], {
      env: ENV, now: NOW, ...recorder(), fetchEvents: async () => [],
    });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(await readFile(s.out, 'utf8')).events, []);
  } finally {
    await s.cleanup();
  }
});

/* ── write-only-on-change ────────────────────────────────────────────── */

test('a second run over an unchanged calendar does not rewrite the file', async () => {
  const s = await scratch();
  const log = recorder();
  try {
    await run(['--config', s.configPath], { env: ENV, now: NOW, fetchEvents: ok(), ...recorder() });
    const first = await stat(s.out);

    // Coarse mtime resolution on some filesystems would make an
    // immediate rewrite look identical, so compare the inode's mtimeMs
    // after a real gap in the value space: assert on content identity
    // AND on the reported status line.
    await run(['--config', s.configPath], { env: ENV, now: NOW, fetchEvents: ok(), ...log });
    const second = await stat(s.out);

    assert.equal(first.mtimeMs, second.mtimeMs, 'file was rewritten despite no change');
    assert.ok(log.stdout.join('\n').includes('already up to date'));
  } finally {
    await s.cleanup();
  }
});

test('a changed calendar does rewrite the file', async () => {
  const s = await scratch();
  try {
    await run(['--config', s.configPath], { env: ENV, now: NOW, fetchEvents: ok(), ...recorder() });
    const before = await readFile(s.out, 'utf8');
    await run(['--config', s.configPath], {
      env: ENV, now: NOW, ...recorder(),
      fetchEvents: async () => fixture.slice(0, 2),
    });
    assert.notEqual(await readFile(s.out, 'utf8'), before);
  } finally {
    await s.cleanup();
  }
});

/* ── fail-soft ───────────────────────────────────────────────────────── */

test('a failed fetch keeps the existing artifact and exits 0', async () => {
  const s = await scratch();
  const log = recorder();
  try {
    await run(['--config', s.configPath], { env: ENV, now: NOW, fetchEvents: ok(), ...recorder() });
    const good = await readFile(s.out, 'utf8');

    const code = await run(['--config', s.configPath], {
      env: ENV, now: NOW, fetchEvents: boom(), ...log,
    });

    assert.equal(code, 0, 'a transient Google failure must not fail the deploy');
    assert.equal(await readFile(s.out, 'utf8'), good, 'existing artifact was clobbered');
    assert.ok(log.stderr.join('\n').includes('keeping the existing'));
  } finally {
    await s.cleanup();
  }
});

test('a failed fetch with no artifact says so loudly, and still exits 0', async () => {
  // Exit 0 because it is still transient — but the consumer's build is
  // about to hit a missing file, so the log has to be unambiguous.
  const s = await scratch();
  const log = recorder();
  try {
    const code = await run(['--config', s.configPath], {
      env: ENV, now: NOW, fetchEvents: boom(), ...log,
    });
    assert.equal(code, 0);
    assert.ok(log.stderr.join('\n').includes('no existing artifact'));
    await assert.rejects(readFile(s.out, 'utf8'));
  } finally {
    await s.cleanup();
  }
});

test('--strict turns a failed fetch into a non-zero exit', async () => {
  const s = await scratch();
  try {
    const code = await run(['--config', s.configPath, '--strict'], {
      env: ENV, now: NOW, fetchEvents: boom(), ...recorder(),
    });
    assert.equal(code, 1);
  } finally {
    await s.cleanup();
  }
});

/* ── configuration errors: loud, always ──────────────────────────────── */

test('an unknown flag exits 1 even without --strict', async () => {
  const log = recorder();
  const code = await run(['--wat'], { env: ENV, now: NOW, ...log });
  assert.equal(code, 1);
  assert.ok(log.stderr.join('\n').includes('unknown argument'));
});

test('a missing config file exits 1', async () => {
  const code = await run(['--config', '/nonexistent/gcal.config.json'], { env: ENV, now: NOW, ...recorder() });
  assert.equal(code, 1);
});

test('malformed config JSON exits 1', async () => {
  const s = await scratch();
  const log = recorder();
  try {
    await writeFile(s.configPath, '{ not json');
    const code = await run(['--config', s.configPath], { env: ENV, now: NOW, ...log });
    assert.equal(code, 1);
    assert.ok(log.stderr.join('\n').includes('not valid JSON'));
  } finally {
    await s.cleanup();
  }
});

test('a config carrying an apiKey is rejected outright', async () => {
  // A key in a committed file is the exact mistake this tool exists to
  // make hard — a warning would be too quiet.
  const s = await scratch({ apiKey: 'AIzaLeakedInGit' });
  const log = recorder();
  try {
    const code = await run(['--config', s.configPath], { env: ENV, now: NOW, ...log });
    assert.equal(code, 1);
    assert.ok(log.stderr.join('\n').includes('GCAL_API_KEY'));
  } finally {
    await s.cleanup();
  }
});

test('a missing GCAL_API_KEY exits 1', async () => {
  const s = await scratch();
  const log = recorder();
  try {
    const code = await run(['--config', s.configPath], { env: {}, now: NOW, ...log });
    assert.equal(code, 1);
    assert.ok(log.stderr.join('\n').includes('GCAL_API_KEY'));
  } finally {
    await s.cleanup();
  }
});

test('a config missing a required key names the key', async () => {
  const s = await scratch();
  const log = recorder();
  try {
    await writeFile(s.configPath, JSON.stringify({ calendarId: 'a@b.c', out: 'x.json' }));
    const code = await run(['--config', s.configPath], { env: ENV, now: NOW, ...log });
    assert.equal(code, 1);
    assert.ok(log.stderr.join('\n').includes('timeZone'));
  } finally {
    await s.cleanup();
  }
});

/* ── argument parsing ────────────────────────────────────────────────── */

test('parseArgs handles both --config forms and defaults', () => {
  assert.deepEqual(parseArgs([]), { config: 'gcal.config.json', strict: false, help: false });
  assert.equal(parseArgs(['--config', 'a.json']).config, 'a.json');
  assert.equal(parseArgs(['--config=b.json']).config, 'b.json');
  assert.equal(parseArgs(['--strict']).strict, true);
  assert.equal(parseArgs(['-h']).help, true);
  assert.throws(() => parseArgs(['--config']), /needs a path/);
  assert.throws(() => parseArgs(['nope']), /unknown argument/);
});

test('--help prints usage and exits 0', async () => {
  const log = recorder();
  const code = await run(['--help'], { env: {}, now: NOW, ...log });
  assert.equal(code, 0);
  assert.ok(log.stdout.join('\n').includes('gcal-sync'));
});

test('loadConfig surfaces the offending path in its error', async () => {
  await assert.rejects(loadConfig('/nope/gcal.config.json'), /\/nope\/gcal\.config\.json/);
});

/* ── the entry-point guard ───────────────────────────────────────────── */

test('isMain matches through a bin symlink', async () => {
  // The production invocation path. npm installs a bin as a symlink, so
  // argv[1] is the link and import.meta.url is the real file — a plain
  // string compare misses, and the CLI exits 0 having done nothing.
  const { symlink } = await import('node:fs/promises');
  const real = join(here, '..', 'bin', 'gcal-sync.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'gcal-bin-'));
  const link = join(dir, 'gcal-sync');
  try {
    await symlink(real, link);
    assert.equal(isMain(link, new URL(`file://${real}`).href), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isMain does not match an unrelated entry point', () => {
  const real = join(here, '..', 'bin', 'gcal-sync.mjs');
  assert.equal(isMain(join(here, 'cli.test.mjs'), new URL(`file://${real}`).href), false);
  assert.equal(isMain(undefined, new URL(`file://${real}`).href), false);
});
