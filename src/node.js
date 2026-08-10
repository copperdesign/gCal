/*! gCal — v0.4.0 - 2026-08-10
 * https://copperdesign.github.io/
 *
 * Copyright (c) 2026 Christian Fillies;
 * Licensed under the MIT license */

/**
 * @docs ../README.md#server-side-rendering-ssg
 *
 * @copperdesign/gcal/node — the build-time half of the library.
 *
 *   import { fetchAllEvents, normalizeEvents, serializeArtifact }
 *     from '@copperdesign/gcal/node';
 *
 * Why this exists: in the browser path the VISITOR's browser calls the
 * Calendar API, which transfers their IP to Google and therefore needs
 * informed consent. It also means the events aren't in the shipped HTML
 * at all — invisible to crawlers, to LLMs, and to a screen reader
 * before opt-in.
 *
 * Fetching at build time inverts both: the events become static markup,
 * no visitor ever contacts Google, no API key ships in page source, and
 * Google sees one request per build instead of one per visitor.
 *
 * DETERMINISM IS THE CONTRACT (see `normalizeEvents`)
 * Consumers commit the artifact and gate their deploy on whether it
 * changed. If the output wobbles between runs the gate fires every
 * night and the whole thing is worse than useless — so everything in
 * here is ordered, allow-listed, and free of timestamps by
 * construction, not by convention.
 *
 * This module deliberately imports NOTHING DOM-bound — not `index.js`,
 * not `template.js`. It must stay importable in plain Node with no
 * shim; `test/node.test.mjs` asserts that.
 */

import { fetchEvents, fetchEventsPage } from './fetch.js';

export { fetchEvents };
export { formatEventDates } from './dates.js';

/**
 * Artifact format version. A CONSTANT — never a timestamp, never a
 * hash — so it can live in the output without breaking byte-stability.
 * Bump it when the shape of a normalized event changes, so a consumer
 * can tell "this file is older than my renderer" from "the calendar is
 * empty".
 */
export const SCHEMA_VERSION = 1;

/* Fields we keep, in the order we emit them.
   ---------------------------------------------------------------------------
   Everything NOT on this list is dropped, and the omissions are the point:
   `etag`, `updated`, `sequence` and friends change without the event
   changing, so carrying them would produce a fresh diff most nights and
   defeat the deploy gate. Add a field here only after checking it's stable. */
const EVENT_FIELDS = ['id', 'start', 'end', 'allDay', 'summary', 'description', 'location', 'htmlLink'];

// Google emits at most these three on either side of an event, and all
// three are stable. Fixed order so the serialized shape can't drift.
const DATE_FIELDS = ['date', 'dateTime', 'timeZone'];

/**
 * Fetch every page of a calendar's events.
 *
 * `fetchEvents` stops at `maxResults` (default 100) and silently drops
 * the rest — survivable in a browser widget showing "the next few
 * events", but wrong for a build that's supposed to render the whole
 * calendar. A busy calendar would just quietly lose its tail.
 *
 * Same config as `fetchEvents`; `maxResults` becomes the PAGE size
 * rather than a cap.
 */
export async function fetchAllEvents(config, { signal } = {}) {
  const items = [];
  let pageToken;
  // Google always returns a token when more pages exist, and omits it on
  // the last page. The seen-set is a cheap guard against a malformed
  // response pointing at itself — an infinite loop in a nightly job is a
  // uniquely annoying thing to debug.
  const seen = new Set();
  do {
    const page = await fetchEventsPage({ ...config, pageToken }, { signal });
    items.push(...page.items);
    pageToken = page.nextPageToken;
    if (pageToken && seen.has(pageToken)) break;
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return items;
}

/**
 * Google Calendar events → a stable, minimal array.
 *
 * The one hard requirement: given the same calendar contents, this
 * returns the same thing every time — same fields, same key order, same
 * element order — regardless of what order the API happened to return
 * and regardless of when it was called.
 *
 * Returns a plain array so callers can filter/map it directly. The
 * `schemaVersion` wrapper lives in `serializeArtifact`, because it
 * describes the FILE, not the events.
 */
export function normalizeEvents(items = []) {
  return items
    .map(normalizeEvent)
    .sort(byStartThenId);
}

function normalizeEvent(event) {
  // Built key-by-key in EVENT_FIELDS order — never by spreading the API
  // object, which would carry both unknown fields and the API's key
  // order into the output.
  const out = {};
  for (const field of EVENT_FIELDS) {
    switch (field) {
      case 'allDay':
        // The authoritative signal: timed events carry `dateTime`,
        // all-day events only `date`. Derived once here so downstream
        // renderers don't each re-derive it (and get it subtly wrong).
        out.allDay = !event.start?.dateTime;
        break;
      case 'start':
      case 'end':
        out[field] = normalizeDateSide(event[field]);
        break;
      default:
        // Absent and empty collapse to '' so a field appearing/disappearing
        // upstream doesn't change the key SET, only a value. Same keys every
        // time is what makes two artifacts comparable at all.
        out[field] = event[field] ?? '';
    }
  }
  return out;
}

function normalizeDateSide(side = {}) {
  const out = {};
  for (const field of DATE_FIELDS) {
    if (side[field] != null) out[field] = side[field];
  }
  return out;
}

/**
 * Total order: instant, then the raw start string, then id.
 *
 * Instant alone isn't enough — two events can start at the same moment,
 * and then the sort would fall back to the input order, which is exactly
 * the non-determinism we're trying to eliminate. The raw string breaks
 * ties between equal instants written differently (an all-day `date` and
 * a midnight `dateTime`), and `id` breaks everything else.
 *
 * `id` alone would ALSO be wrong as the primary key: an expanded
 * recurring series shares one base id with an instance-start suffix, so
 * id order and chronological order disagree.
 */
function byStartThenId(a, b) {
  const av = startValue(a);
  const bv = startValue(b);
  if (av !== bv) return av - bv;
  const as = rawStart(a);
  const bs = rawStart(b);
  if (as !== bs) return as < bs ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const rawStart = (e) => e.start.dateTime ?? e.start.date ?? '';

function startValue(e) {
  const t = Date.parse(rawStart(e));
  // An unparseable date sorts last rather than throwing — a single
  // malformed event shouldn't take down a nightly build. NaN would make
  // every comparison false and silently corrupt the whole order.
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/**
 * Normalized events → the exact JSON text to write to disk.
 *
 * Canonical on purpose. Three consuming sites serializing "the same"
 * object three slightly different ways (indentation, trailing newline,
 * key order) would each get their own spurious nightly diff, so the
 * byte-for-byte decision is made once, here.
 *
 * Two-space indent and a trailing newline because the file is committed
 * and read in PR diffs by humans.
 */
export function serializeArtifact(events) {
  return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, events }, null, 2)}\n`;
}

/**
 * The instant at which `now`'s day starts in `timeZone`, as an ISO
 * string — i.e. what to pass as `timeMin`.
 *
 * THIS IS NOT A CONVENIENCE. Passing `new Date().toISOString()` as
 * `timeMin` (which the browser path does, correctly, for its purposes)
 * puts a fresh timestamp into the request every run. Any event boundary
 * near "now" then flickers in and out of the result set, the artifact
 * changes for no reason, and the deploy gate fires nightly.
 *
 * The time zone is a required argument rather than defaulting to UTC
 * because a job at 01:00 UTC is already 02:00 or 03:00 in Berlin — a
 * UTC-floored `timeMin` would drop an event that's still happening
 * today locally.
 */
export function startOfDay(timeZone, now = new Date()) {
  const { year, month, day } = zonedParts(timeZone, now);
  const wallClock = Date.UTC(year, month - 1, day);
  // Convert wall-clock-midnight to a real instant by subtracting the
  // zone's offset. Applied twice because the offset is itself a function
  // of the instant: on a DST boundary the first guess can land on the
  // wrong side of the transition, and the second pass corrects it.
  let instant = wallClock - offsetAt(timeZone, new Date(wallClock));
  instant = wallClock - offsetAt(timeZone, new Date(instant));
  return new Date(instant).toISOString();
}

function zonedParts(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const out = {};
  for (const { type, value } of parts) {
    if (type !== 'literal') out[type] = Number(value);
  }
  // en-US with hour12:false renders midnight as hour 24 in some ICU
  // versions. Fold it back so arithmetic on the value can't jump a day.
  out.hour %= 24;
  return out;
}

// How far the zone is ahead of UTC at `date`, in ms. Derived by reading
// the wall clock in that zone and diffing it against the real instant —
// no offset table, no DST rules of our own.
function offsetAt(timeZone, date) {
  const p = zonedParts(timeZone, date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

/**
 * Events → an HTML string.
 *
 * No default markup, matching the browser renderer's position: the
 * library doesn't ship an opinion on markup. `row` gets
 * `(event, index, all)` — the index and the full array are part of the
 * contract, because neighbour-aware rendering (collapsing a repeated
 * date pill, grouping by month) is common and otherwise forces every
 * consumer to re-implement the loop just to see its neighbours.
 *
 * `empty` is returned verbatim for an empty list, so the caller decides
 * whether that's a message, a hidden element, or nothing at all.
 */
export function renderEventsToString(items = [], { row, empty = '', wrap } = {}) {
  if (typeof row !== 'function') throw new TypeError('gCal: row must be a function');
  if (items.length === 0) return empty;
  const html = items.map((event, i, all) => row(event, i, all)).join('');
  return wrap ? wrap(html) : html;
}

/**
 * Text-node escaping. Exists so three consuming sites don't each write
 * their own subtly different version.
 *
 * NOT applied automatically: Google returns real HTML in `description`,
 * and escaping it would visibly break every event that uses formatting.
 * Escape `summary` and `location`; leave `description` alone. The
 * asymmetry is deliberate and documented in the README.
 */
export function escapeHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Attribute values additionally need the quote character.
export function escapeAttr(value = '') {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/* ── provenance ──────────────────────────────────────────────────────────
   Answering "what produced this HTML?" from the HTML itself. Three things
   can put a calendar on a page — a browser fetch, a build fired by a
   calendar edit, or a build fired by the nightly cron — and from the
   outside they are indistinguishable, which makes "is this stale, and if
   so which half is broken?" much harder to answer than it should be.

   NOT IN THE ARTIFACT, and this is the whole design constraint. Putting a
   trigger name or a timestamp into the JSON would make a cron run and a
   dispatch run differ byte-for-byte over an identical calendar, the deploy
   gate would fire on every alternation, and the determinism contract that
   the entire sync rests on would be gone. Provenance describes the RENDER,
   so it lives in the rendered output and nowhere else.

   No version number either, deliberately. The only version string in `src/`
   is the banner, kept in step by `scripts/stamp-banners.mjs` and asserted
   by CI. A second one here would be a second thing to keep in sync and
   would go stale silently — the same reason `bin/gcal-sync.mjs` carries no
   banner. */

/**
 * Which CI event produced this build.
 *
 * Reads `GITHUB_EVENT_NAME`, which Actions sets on every run. That is a
 * deliberate coupling and a small one: this package already ships a
 * reusable Actions workflow and a CLI aimed at it, and `trigger` is an
 * argument on `provenanceComment` for anyone building elsewhere.
 */
export function detectBuildTrigger(env = process.env) {
  switch (env.GITHUB_EVENT_NAME) {
    // The calendar told us. See docs/instant-updates.md.
    case 'repository_dispatch': return 'calendar-trigger';
    // The safety net ran. Also the only thing that expires past events.
    case 'schedule':            return 'nightly-cron';
    case 'workflow_dispatch':   return 'manual';
    case 'push':                return 'push';
    default:                    return env.CI ? 'ci' : 'local';
  }
}

/**
 * An HTML comment naming what produced the markup. Place it wherever you
 * want it visible — the library doesn't inject it, same as it ships no
 * other markup of its own.
 *
 *   provenanceComment()                    // <!-- gcal · server-rendered · nightly-cron -->
 *   provenanceComment({ trigger: 'cms' })  // <!-- gcal · server-rendered · cms -->
 *
 * `at` is opt-in rather than automatic: a timestamp in the output makes
 * every build differ from the last, which is fine if you already stamp a
 * build date into your pages and actively unhelpful if you diff them.
 */
export function provenanceComment({ trigger = detectBuildTrigger(), at } = {}) {
  const parts = ['gcal', 'server-rendered', trigger];
  if (at) parts.push(at);
  // `--` cannot appear inside an HTML comment; a caller-supplied trigger
  // containing one would produce markup that terminates early and eats the
  // rest of the document.
  return `<!-- ${parts.join(' · ').replace(/--+/g, '-')} -->`;
}

// One day in ms. See `inclusiveEndDate` for why UTC parsing makes this safe.
const DAY_MS = 86_400_000;

/**
 * The last date an event actually covers, as `YYYY-MM-DD` (all-day) or
 * the raw `dateTime` (timed).
 *
 * Google's all-day `end.date` is EXCLUSIVE: an event on the 5th reports
 * `end.date: "2026-09-06"`. schema.org's `endDate` is INCLUSIVE. Publish
 * the raw value into JSON-LD and every date is advertised a day longer
 * than it is — a wrong date in a rich result, which is worse than no
 * rich result at all.
 *
 * This is the same argument that puts `allDay` on a normalized event:
 * derive the sharp edge once here, rather than have each consuming site
 * write its own version and get it subtly wrong. The failure mode is
 * what makes it worth exporting — nothing throws, nothing looks broken,
 * the date is just quietly off by one on a live page.
 *
 * Accepts a raw Google event or a normalized one; `end` alone is
 * authoritative, so it doesn't need `start`.
 *
 * `YYYY-MM-DD` parses as UTC midnight, so the subtraction lands on the
 * previous UTC midnight and `slice(0, 10)` reads back the intended
 * calendar date regardless of the host's local zone.
 */
export function inclusiveEndDate(event = {}) {
  const end = event.end ?? {};
  if (end.dateTime) return end.dateTime;
  if (!end.date) return '';
  return new Date(Date.parse(`${end.date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/**
 * HTML → plain text, for `<meta name="description">`, OG tags, JSON-LD
 * and any other text-only surface.
 *
 * The inverse of `escapeHtml`, and here for the same stated reason: it's
 * small, everyone doing structured data needs it, and everyone writes it
 * slightly differently. `description` is real HTML by design — see the
 * escaping asymmetry in the README — so flattening it is a step every
 * consumer hits, not an edge case.
 *
 * Two ordering decisions that are easy to get backwards:
 *   · Tags are stripped BEFORE entities are decoded, so an escaped
 *     `&lt;script&gt;` in the calendar text survives as literal text
 *     instead of being decoded into a tag and then stripped.
 *   · `&amp;` is decoded LAST, so `&amp;lt;` yields the literal `&lt;`
 *     rather than being double-decoded into `<`.
 *
 * Not a sanitizer, and not trying to be — the output is text, so there
 * is nothing left to sanitize.
 */
export function plainText(html = '') {
  return String(html)
    // Block boundaries become spaces first, or adjacent lines run together.
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
