/**
 * @docs ../README.md#server-side-rendering-ssg
 *
 * Tests for the `/node` entry point.
 *
 * The determinism tests are the important ones. Consumers commit the
 * artifact and gate their deploy on whether it changed, so a regression
 * here doesn't look like a bug — it looks like a site that quietly
 * redeploys every night forever. Each of them is written to fail loudly
 * if the allowlist, the sort, or the serializer drifts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fetchEvents,
  fetchAllEvents,
  normalizeEvents,
  serializeArtifact,
  startOfDay,
  renderEventsToString,
  escapeHtml,
  escapeAttr,
  formatEventDates,
  SCHEMA_VERSION,
} from '../src/node.js';

const here    = dirname(fileURLToPath(import.meta.url));
const srcDir  = join(here, '..', 'src');
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'events.json'), 'utf8'));

// Deterministic shuffle — a seeded swap rather than Math.random, so a
// failure is reproducible instead of showing up one run in five.
function shuffled(list) {
  const out = [...list];
  let seed = 42;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ── surface ─────────────────────────────────────────────────────────── */

test('exports the documented surface', () => {
  for (const [name, fn] of Object.entries({
    fetchEvents, fetchAllEvents, normalizeEvents, serializeArtifact,
    startOfDay, renderEventsToString, escapeHtml, escapeAttr, formatEventDates,
  })) {
    assert.equal(typeof fn, 'function', `${name} should be a function`);
  }
  assert.equal(SCHEMA_VERSION, 1);
});

test('import graph never reaches the DOM-bound modules', () => {
  // Static walk rather than a runtime check: template.js only touches
  // `document` inside function bodies, so merely importing it would NOT
  // throw in Node. The damage would show up later, in a consumer's
  // build, as a confusing ReferenceError.
  const forbidden = new Set(['template.js', 'index.js', 'consent.js']);
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(join(srcDir, file), 'utf8');
    for (const m of src.matchAll(/from\s+'\.\/([\w.-]+)'/g)) {
      assert.ok(!forbidden.has(m[1]), `src/node.js transitively imports ${m[1]} (via ${file})`);
      walk(m[1]);
    }
  };
  walk('node.js');
});

/* ── determinism ─────────────────────────────────────────────────────── */

test('normalizeEvents is byte-stable across runs', () => {
  assert.equal(
    serializeArtifact(normalizeEvents(fixture)),
    serializeArtifact(normalizeEvents(fixture)),
  );
});

test('normalizeEvents is independent of input order', () => {
  // The fixture is deliberately NOT in chronological order, so this is
  // the test that actually proves the sort exists.
  assert.equal(
    serializeArtifact(normalizeEvents(fixture)),
    serializeArtifact(normalizeEvents(shuffled(fixture))),
  );
});

test('volatile API metadata never reaches the artifact', () => {
  // Every one of these can change without the event changing — carrying
  // any of them would produce a fresh diff most nights.
  const volatileKeys = [
    'etag', 'updated', 'created', 'iCalUID', 'sequence', 'reminders',
    'creator', 'organizer', 'kind', 'status', 'recurringEventId', 'originalStartTime',
  ];
  const json = serializeArtifact(normalizeEvents(fixture));
  for (const key of volatileKeys) {
    assert.ok(!json.includes(`"${key}"`), `artifact still carries "${key}"`);
  }
});

test('artifact contains no generation timestamp', () => {
  // The millisecond-UTC form is what Google's metadata timestamps use;
  // legitimate event times are offset-form ("+02:00") and survive.
  const json = serializeArtifact(normalizeEvents(fixture));
  assert.equal(json.match(/\d{2}:\d{2}:\d{2}\.\d{3}Z/), null);
  assert.ok(!/generatedAt|syncedAt|fetchedAt/.test(json));
});

test('every event has the same key set, in the same order', () => {
  const events = normalizeEvents(fixture);
  const expected = ['id', 'start', 'end', 'allDay', 'summary', 'description', 'location', 'htmlLink'];
  for (const event of events) {
    assert.deepEqual(Object.keys(event), expected);
  }
});

test('serializeArtifact wraps events with a constant schemaVersion', () => {
  const json = serializeArtifact(normalizeEvents(fixture));
  const parsed = JSON.parse(json);
  assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
  assert.equal(parsed.events.length, fixture.length);
  assert.ok(json.endsWith('\n'), 'artifact should end with a newline');
});

/* ── normalization detail ────────────────────────────────────────────── */

test('allDay is derived from the presence of dateTime', () => {
  const byId = Object.fromEntries(normalizeEvents(fixture).map((e) => [e.id, e]));
  assert.equal(byId['b2h8s4vdiary000000001'].allDay, true);
  assert.equal(byId['7f3k2m9qabcdefghijklmnop_20260612T170000Z'].allDay, false);
});

test('raw start/end shapes are preserved alongside allDay', () => {
  const byId = Object.fromEntries(normalizeEvents(fixture).map((e) => [e.id, e]));
  assert.deepEqual(byId['b2h8s4vdiary000000001'].start, { date: '2026-07-04' });
  assert.deepEqual(byId['7f3k2m9qabcdefghijklmnop_20260612T170000Z'].start, {
    dateTime: '2026-06-12T19:00:00+02:00',
    timeZone: 'Europe/Berlin',
  });
});

test('a missing field becomes an empty string, not a missing key', () => {
  // Same keys every time is what makes two artifacts comparable at all.
  const noLocation = normalizeEvents(fixture).find((e) => e.id === 'q1w2e3r4t5y6u7i8o9p0');
  assert.equal(noLocation.location, '');
  assert.ok('location' in noLocation);
});

test('events sort chronologically, with id breaking an exact tie', () => {
  const ids = normalizeEvents(fixture).map((e) => e.id);
  assert.deepEqual(ids, [
    '7f3k2m9qabcdefghijklmnop_20260605T170000Z', // 05 Jun
    '7f3k2m9qabcdefghijklmnop_20260612T170000Z', // 12 Jun 19:00 — tie, "7" < "q"
    'q1w2e3r4t5y6u7i8o9p0',                      // 12 Jun 19:00 — tie
    'b2h8s4vdiary000000001',                     // 04 Jul
    'zz9plural000000000002',                     // 18 Sep
    'aa00bb11cc22dd33ee44',                      // 29 Dec
  ]);
});

test('an unparseable start sorts last instead of corrupting the order', () => {
  const broken = [{ id: 'broken', start: { dateTime: 'not-a-date' }, end: {} }, ...fixture];
  const ids = normalizeEvents(broken).map((e) => e.id);
  assert.equal(ids.at(-1), 'broken');
  assert.equal(ids.length, broken.length);
});

test('an empty calendar normalizes to an empty array', () => {
  assert.deepEqual(normalizeEvents([]), []);
  assert.deepEqual(normalizeEvents(), []);
});

/* ── startOfDay ──────────────────────────────────────────────────────── */

test('startOfDay floors to local midnight, not UTC midnight', () => {
  // 01:00 UTC is already 03:00 in Berlin — the case that motivates the
  // whole function. A UTC floor here would drop today's events.
  assert.equal(
    startOfDay('Europe/Berlin', new Date('2026-08-09T01:00:00Z')),
    '2026-08-08T22:00:00.000Z',
  );
});

test('startOfDay is correct across both DST boundaries', () => {
  // 29 Mar 2026: DST begins at 02:00, so midnight is still CET (+01:00).
  assert.equal(
    startOfDay('Europe/Berlin', new Date('2026-03-29T12:00:00Z')),
    '2026-03-28T23:00:00.000Z',
  );
  // 25 Oct 2026: DST ends at 03:00, so midnight is still CEST (+02:00).
  assert.equal(
    startOfDay('Europe/Berlin', new Date('2026-10-25T12:00:00Z')),
    '2026-10-24T22:00:00.000Z',
  );
});

test('startOfDay returns the same instant all day long', () => {
  // The property that actually protects the deploy gate: two runs on the
  // same local day must produce the same timeMin.
  const morning = startOfDay('Europe/Berlin', new Date('2026-08-09T05:30:00Z'));
  const evening = startOfDay('Europe/Berlin', new Date('2026-08-09T20:45:00Z'));
  assert.equal(morning, evening);
});

test('startOfDay honours the requested zone', () => {
  const utc = startOfDay('UTC', new Date('2026-08-09T12:00:00Z'));
  assert.equal(utc, '2026-08-09T00:00:00.000Z');
});

/* ── rendering ───────────────────────────────────────────────────────── */

test('renderEventsToString returns `empty` verbatim for an empty list', () => {
  assert.equal(renderEventsToString([], { row: () => 'x', empty: '<p>none</p>' }), '<p>none</p>');
  assert.equal(renderEventsToString([], { row: () => 'x' }), '');
});

test('renderEventsToString emits one row per event, in order', () => {
  const events = normalizeEvents(fixture);
  const html = renderEventsToString(events, { row: (e) => `<li>${escapeHtml(e.summary)}</li>` });
  assert.equal(html.match(/<li>/g).length, events.length);
  assert.ok(html.startsWith('<li>Märchen &amp; Musik — Reihe, 1. Abend</li>'));
});

test('row receives (event, index, all) so neighbours are reachable', () => {
  const events = normalizeEvents(fixture);
  const seen = [];
  renderEventsToString(events, {
    row: (event, index, all) => {
      seen.push([event.id, index, all.length]);
      return '';
    },
  });
  assert.equal(seen.length, events.length);
  assert.deepEqual(seen.map((s) => s[1]), events.map((_, i) => i));
  assert.ok(seen.every((s) => s[2] === events.length));
});

test('wrap composes around the joined rows', () => {
  const html = renderEventsToString([{ id: 'a' }, { id: 'b' }], {
    row: (e) => `<li>${e.id}</li>`,
    wrap: (rows) => `<ul>${rows}</ul>`,
  });
  assert.equal(html, '<ul><li>a</li><li>b</li></ul>');
});

test('renderEventsToString rejects a missing row function', () => {
  assert.throws(() => renderEventsToString([{ id: 'a' }], {}), TypeError);
});

test('escapeHtml and escapeAttr cover the characters that matter', () => {
  assert.equal(escapeHtml('Lesung <Sonderformat> & "Gespräch"'), 'Lesung &lt;Sonderformat&gt; &amp; "Gespräch"');
  assert.equal(escapeAttr('Lesung <Sonderformat> & "Gespräch"'), 'Lesung &lt;Sonderformat&gt; &amp; &quot;Gespräch&quot;');
  assert.equal(escapeHtml(), '');
  assert.equal(escapeAttr(undefined), '');
});

/* ── date formatting under Node ──────────────────────────────────────── */

test('formatEventDates works under Node ICU with German month names', () => {
  const event = fixture.find((e) => e.id === 'q1w2e3r4t5y6u7i8o9p0');
  const dates = formatEventDates(event, { locale: 'de-DE', timeZone: 'Europe/Berlin' });
  assert.equal(dates.startMonth, 'Juni');
  assert.equal(dates.allDay, false);
  assert.equal(dates.startTime, '19:00');
  // Guards against a small-ICU runtime silently falling back to English.
  assert.ok(dates.dates.includes('Juni'), `expected German month, got "${dates.dates}"`);
});

/* ── pagination ──────────────────────────────────────────────────────── */

test('fetchAllEvents walks every page', async () => {
  const pages = [
    { items: [{ id: 'a' }], nextPageToken: 't1' },
    { items: [{ id: 'b' }], nextPageToken: 't2' },
    { items: [{ id: 'c' }] },
  ];
  const tokens = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    tokens.push(new URL(url).searchParams.get('pageToken'));
    return { ok: true, json: async () => pages.shift() };
  };
  try {
    const items = await fetchAllEvents({ calendarId: 'c@example.com', apiKey: 'k' });
    assert.deepEqual(items.map((i) => i.id), ['a', 'b', 'c']);
    assert.deepEqual(tokens, [null, 't1', 't2']);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchAllEvents refuses to loop on a self-referencing token', async () => {
  // A malformed response pointing at itself would otherwise spin
  // forever — a uniquely annoying failure inside a nightly job.
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ items: [{ id: 'x' }], nextPageToken: 'same' }) };
  };
  try {
    await fetchAllEvents({ calendarId: 'c@example.com', apiKey: 'k' });
    assert.ok(calls < 5, `expected the loop guard to trip, made ${calls} requests`);
  } finally {
    globalThis.fetch = original;
  }
});
