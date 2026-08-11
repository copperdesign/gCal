# @copperdesign/gcal

[![npm version](https://img.shields.io/npm/v/@copperdesign/gcal.svg)](https://www.npmjs.com/package/@copperdesign/gcal)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@copperdesign/gcal)](https://bundlephobia.com/package/@copperdesign/gcal)
[![license](https://img.shields.io/npm/l/@copperdesign/gcal.svg)](./LICENSE)

Render a public Google Calendar into HTML you control — in the browser, or at build time. Template-driven, locale-aware, consent-friendly. Zero dependencies, ESM only.

```bash
npm install @copperdesign/gcal
```

## What it does

Two modes, sharing one set of primitives.

**In the browser** (`@copperdesign/gcal`) you point it at a public Google Calendar and an HTML `<template>`. It fetches events from the Calendar v3 API, clones the template per event, fills `data-slot` attributes with event fields, and appends them to a target element. ~7KB unminified.

**At build time** (`@copperdesign/gcal/node`) it fetches the calendar on your build machine instead, normalizes it into a byte-stable JSON file, and hands you a string renderer. Your site ships static markup: no consent gate, no API key in page source, events visible to crawlers and screen readers, and one API call per day rather than one per visitor. See [Server-side rendering](#server-side-rendering-ssg).

Either way: no framework, no virtual DOM, no jQuery, no runtime dependencies.

## Quick start

```html
<div id="events"></div>

<template id="gcal-row">
  <article class="gcal-event">
    <header data-slot="dates"></header>
    <h3 data-slot="summary"></h3>
    <p data-slot="description" data-html></p>
    <a data-slot="mapLink" data-attr="href" hidden>Karte</a>
    <a data-slot="htmlLink" data-attr="href" hidden>Details</a>
  </article>
</template>

<script type="module">
  import { GCal } from '@copperdesign/gcal';

  new GCal({
    target:     '#events',
    template:   '#gcal-row',
    calendarId: 'YOUR_CALENDAR_ID@group.calendar.google.com',
    apiKey:     'YOUR_API_KEY',
  }).mount();
</script>
```

## Google Cloud setup

Three things have to be in place before the library can fetch anything:

1. **Make the calendar public.** Google Calendar → your calendar's *Settings and sharing* → *Access permissions* → tick **Make available to public**. The **Calendar ID** (`…@group.calendar.google.com`) is further down on the same page under *Integrate calendar*.

2. **Create an API key.** [Google Cloud Console](https://console.cloud.google.com/) → *APIs & Services* → *Library* → enable **Google Calendar API**. Then *Credentials* → *Create credentials → API key*.

3. **Restrict the key.** It ships in your page source — anyone viewing your site can read it. Two restrictions stop it being reused elsewhere:
   - **Application restrictions → HTTP referrers (websites)** → add every host the embed runs on. Google requires the `*` wildcard form: `https://example.com/*`, `https://www.example.com/*`, plus any staging or preview domain.
   - **API restrictions → Restrict key** → select **Google Calendar API** only.

Without the restrictions the key still works, but any visitor who copies it can use your project's quota from anywhere.

### 4. A second key, for server-side use

Only needed if you're using [server-side rendering](#server-side-rendering-ssg). Skip it for the browser path.

**The referrer-restricted key above cannot be used from CI.** Node sends no `Referer` header, so Google rejects the request — and forging one isn't a restriction anyone should build on. Create a second key:

- **API restrictions → Restrict key** → **Google Calendar API** only.
- **Application restrictions → None.**

Then store it as a repository secret, never in a config file:

```sh
gh secret set GCAL_API_KEY --repo <owner>/<repo>
```

**Why leaving the origin unrestricted is acceptable here, specifically:** the key grants read-only access to a calendar that is already public, and the free quota is roughly 1M requests/day against a workload of about 365 a year. It also never appears in page source, so unlike the browser key it can be rotated at any time without touching site source or waiting for a deploy — that's an improvement over the browser path, not a concession.

**Once a site is fully server-side, delete the browser key.** It has no remaining caller, and a live key with your project's quota attached is not something to leave lying in git history.

#### The ICS alternative, and why it isn't the recommendation

Google also publishes a public calendar as an `.ics` feed, which needs no credentials at all — genuinely appealing if you'd rather not run a Cloud project.

The catch is recurring events. The Calendar v3 API expands a recurring series into individual instances for you (`singleEvents=true`, which this library always sets); an ICS feed hands you `RRULE` strings and expects you to expand them yourself, correctly, including exceptions and DST. That is a real chunk of calendar logic to own for the sake of skipping one console visit. Considered and rejected — but if your calendar genuinely has no recurring events, it's a reasonable path to build yourself on top of `normalizeEvents`.

## Template binding

The template is plain HTML inside a `<template>` element. Three attributes control rendering:

| Attribute | Effect |
|---|---|
| `data-slot="summary"` | `element.textContent = data.summary` (escaped) |
| `data-slot="description" data-html` | `element.innerHTML = data.description` (trusted) |
| `data-slot="mapLink" data-attr="href"` | `element.setAttribute('href', data.mapLink)` |
| `data-slot="..." data-remove-empty` | Remove the element when the bound field is empty (default: add `hidden`) |

Available fields after default formatting:

```js
const data = {
  // Direct from Google
  summary, description, location, htmlLink, start, end,

  // Composed by formatEventDates()
  dates,        // "5. Juni bis 7. Juni 2026 um 14:00 Uhr"
  allDay,       // boolean
  sameDay,      // boolean
  sameTime,     // boolean
  startDay,     // "5"
  startMonth,   // "Juni"
  startYear,    // "2026"
  startTime,    // "14:00" (empty for all-day)
  endDay, endMonth, endYear, endTime,  // only set when different from start

  // Derived
  mapLink,      // Google Maps URL built from location, or '' if no location
  total,        // total event count in this render (useful for sizing)
};
```

> **Changed in 0.3.0 — all-day events print one day shorter.** Google's
> all-day `end.date` is exclusive: a single-day event on 15 June reports
> `end.date: "2026-06-16"`. Earlier versions passed that straight through,
> so `dates` read `"15. Juni bis 16. Juni 2026"` for an event covering one
> day, and `sameDay` was `false`. It now reads `"15. Juni 2026"` with
> `sameDay: true`; a 15–17 June event reads `"15. Juni bis 17. Juni 2026"`
> instead of `"…bis 18. Juni"`.
>
> Being faithful to the wire format meant being wrong to every human
> reading the page, and every consumer was correcting it in
> `transformEvent`. **If you wrote such a correction, remove it** — it will
> now shift the date a second day. Timed events are unaffected: only
> `date` is exclusive, `dateTime` is not.
>
> **Also fixed in 0.3.0:** an all-day date names a calendar day, so it now
> renders as that day regardless of `timeZone` or where the page is read.
> Previously it was treated as an instant and came out one day early for
> anyone west of Greenwich — including visitors, since `timeZone` is
> optional and falls back to the runtime's zone. `startDay` / `endDay`
> likewise follow the configured `timeZone` now rather than the host's
> ([#9](https://github.com/copperdesign/gCal/issues/9)).

## Configuration

```js
new GCal({
  // Required
  target:     '#events',           // selector or Element
  template:   '#gcal-row',         // selector, Element, or HTML string
  calendarId: '…@group.calendar.google.com',
  apiKey:     '…',

  // Calendar API knobs (optional)
  maxResults: 100,
  orderBy:    'startTime',         // or 'updated'
  timeMin:    new Date().toISOString(),
  timeMax:    undefined,           // ISO string to cap the range

  // Localization
  locale:     'de-DE',             // default: document.documentElement.lang || 'de-DE'
  timeZone:   'Europe/Berlin',

  // Optional state templates (selectors, elements, or HTML strings)
  emptyTemplate:   '#gcal-empty',
  errorTemplate:   '#gcal-error',
  loadingTemplate: '#gcal-loading',

  // Consent gate (omit for no gating)
  consent: {
    check:   () => window.consent?.hasConsent?.('gcal') ?? false,
    request: async () => window.consent?.optIn?.('gcal'),
    ctaTemplate: '#gcal-cta',      // shown when check() is false
    event:   'consentchange',      // DOM event to re-render on (default: 'consentchange')
  },

  // Hooks
  transformEvent: (event) => ({ ...event, mapLink: customMapUrl(event) }),
  formatDates:    (event) => formatEventDates(event, { locale: 'de-DE' }),
  cleanLocation:  (loc) => loc.replace(/, Deutschland$/, ''),
  onError:        (err) => console.error(err),
}).mount();
```

## Consent flow

The library never imports a specific consent SDK. You implement a small adapter:

```js
import { GCal } from '@copperdesign/gcal';

const consent = {
  check:   () => window.myConsent.has('gcal'),
  request: async () => window.myConsent.optIn('gcal'),
  ctaTemplate: '#gcal-cta',
};

new GCal({ /* …, */ consent }).mount();
```

```html
<template id="gcal-cta">
  <div class="consent-card">
    <p>Beim Laden wird eine Verbindung zu Google hergestellt.</p>
    <button data-gcal-optin>Termine laden</button>
  </div>
</template>
```

When consent is granted (synchronously or by `request()` resolving), the library fetches and renders. If a `consentchange` CustomEvent fires on `document` later (e.g. from a global cookie banner), it re-renders automatically.

### With `@copperdesign/easy-cookie-consent`

The recommended pairing — a zero-dependency, click-to-load consent gate built to the same shape as gCal. The adapter is three lines:

```js
import { GCal } from '@copperdesign/gcal';
import easyCookieConsent from '@copperdesign/easy-cookie-consent';

const ecc = easyCookieConsent({
  // easy-cookie-consent shows a global modal on load by default.
  // If gCal's CTA template is your only consent UI, set this to false.
  // Leave it true (default) to pair the global banner with the per-embed CTA.
  showModal: false,
  // Re-render gCal when consent flips elsewhere on the page
  // (global modal, revoke link, …).
  onConsent: () => document.dispatchEvent(new CustomEvent('consentchange')),
});

new GCal({
  // …,
  consent: {
    check:   () => ecc.hasConsent('gcal'),
    request: () => ecc.optIn('gcal'),
    ctaTemplate: '#gcal-cta',
  },
}).mount();
```

gCal stays provider-agnostic — easy-cookie-consent is opt-in, not bundled.

## State templates

```html
<template id="gcal-empty">
  <p class="gcal-empty">Keine aktuellen Termine.</p>
</template>

<template id="gcal-error">
  <p class="gcal-error">Kalender konnte nicht geladen werden: <span data-slot="message"></span></p>
</template>

<template id="gcal-loading">
  <p class="gcal-loading" aria-busy="true">Termine werden geladen…</p>
</template>
```

## Styling

The library doesn't ship a layout. Style your own template. If you want a starting point, the default stylesheet is at `@copperdesign/gcal/css`:

```html
<link rel="stylesheet" href="https://unpkg.com/@copperdesign/gcal/dist/gcal.css">
```

Tunable via CSS custom properties:

```css
:root {
  --gcal-accent:    #294983;
  --gcal-accent-bg: #99C1E3;
  --gcal-time:      #F5A623;
  --gcal-border:    rgba(0, 0, 0, 0.13);
}
```

## Drop-in (Weebly, no build step)

Weebly has no `npm install` — load gCal from a CDN and paste the whole snippet into a single **Embed Code** element on the page where the calendar should appear:

```html
<link rel="stylesheet" href="https://unpkg.com/@copperdesign/gcal/dist/gcal.css">

<div id="events"></div>

<template id="gcal-row">
  <article class="gcal-event">
    <header data-slot="dates"></header>
    <h3 data-slot="summary"></h3>
    <p data-slot="description" data-html></p>
    <a data-slot="mapLink" data-attr="href" hidden>Karte</a>
  </article>
</template>

<script type="module">
  import { GCal } from 'https://unpkg.com/@copperdesign/gcal';

  new GCal({
    target:     '#events',
    template:   '#gcal-row',
    calendarId: 'YOUR_CALENDAR_ID@group.calendar.google.com',
    apiKey:     'YOUR_API_KEY',
    locale:     'de-DE',
    timeZone:   'Europe/Berlin',
  }).mount();
</script>
```

For a sitewide stylesheet, move the `<link>` into **Settings → SEO → Header Code** so every page gets it without re-pasting.

**Before you paste this live:** complete the steps in [Google Cloud setup](#google-cloud-setup) above — in particular, restrict the API key to your Weebly domain(s) under *HTTP referrers*, since the key ships in page source.

If you need consent gating before the fetch (DSGVO), see [Consent flow](#consent-flow) above and pass a `consent` object alongside the other options.

**Note:** [server-side rendering](#server-side-rendering-ssg) — which removes the need for consent entirely — is not available on this path. It needs a build step, and Weebly has none.

## Imperative API

```js
import { GCal, fetchEvents, formatEventDates, renderTemplate, resolveTemplate } from '@copperdesign/gcal';

const cal = new GCal({ /* … */ });

// One-shot
await cal.render();

// SPA lifecycle
const unmount = cal.mount();
unmount();

// Pre-fetched items (SSR hydration, test fixtures)
cal.renderItems([{ summary: '…', start: { dateTime: '…' }, end: { dateTime: '…' } }]);

// Use the primitives directly
const items = await fetchEvents({ calendarId, apiKey });
const tpl   = resolveTemplate('#gcal-row');
for (const event of items) {
  const data = { ...event, ...formatEventDates(event) };
  document.querySelector('#events').appendChild(renderTemplate(tpl, data));
}
```

## Recipe: the classic listing layout

A common pattern — and the one this library was originally written against —
is the date-pill listing: a coloured date block on the left, a stack of
time / title / description / location on the right, and a "continuous-day"
modifier that hides the date pill for back-to-back events on the same date.

Three derived fields cover the parts the defaults don't produce directly:

- `rowClass` — the full container class string, so a neighbour-dependent
  modifier (`continuous-day`) can be precomputed.
- `timeRange` — a time-only string ("14:00 bis 16:00 Uhr"), since the
  built-in `dates` field always includes the date.
- `locationBlock` — the wrapped `<b>Ort:</b> <a href="…">address</a>`
  fragment, bound through `data-html`. The library's "one binding rule
  per node" forbids putting both `href` and a text label on the same
  `<a>`, and pre-composing the HTML is the cleanest way around it.

Because `continuous-day` depends on the *previous* event, the work
happens in a single pre-pass before `renderItems` (the per-event
`transformEvent` hook can't see neighbours):

```js
import { GCal } from '@copperdesign/gcal';

const timeFmt = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Berlin',
});

function preprocess(items) {
  const dayKey = (e) => (e.start.dateTime ?? e.start.date).slice(0, 10);
  return items.map((e, i, arr) => {
    const sameAsPrev = i > 0 && dayKey(arr[i - 1]) === dayKey(e);
    const rowClass   = sameAsPrev ? 'gcal-row gcal-continuous-day' : 'gcal-row';
    const startTime  = e.start.dateTime ? timeFmt.format(new Date(e.start.dateTime)) : '';
    const endTime    = e.end.dateTime   ? timeFmt.format(new Date(e.end.dateTime))   : '';
    const timeRange  = startTime && endTime ? `${startTime} bis ${endTime} Uhr` : '';
    const locationBlock = e.location
      ? `<b>Ort:</b> <a href="https://maps.google.com/maps?q=${encodeURIComponent(e.location)}" target="_blank">${e.location}</a>`
      : '';
    return { ...e, rowClass, timeRange, locationBlock };
  });
}

const cal = new GCal({
  target: '#events',
  template: '#gcal-row',
  calendarId: '…', apiKey: '…',
  locale: 'de-DE', timeZone: 'Europe/Berlin',
});

// Drive the pipeline yourself when you need pre-render context:
const items = await fetchEvents({ calendarId: '…', apiKey: '…' });
cal.renderItems(preprocess(items));
```

The matching template — structurally identical to the jQuery-era markup
this layout grew out of:

```html
<template id="gcal-row">
  <div data-slot="rowClass" data-attr="class">
    <div class="gcal-cal">
      <div class="gcal-day">
        <div class="gcal-dm" data-slot="startMonth"></div>
        <div class="gcal-dd" data-slot="startDay"></div>
        <div class="gcal-dy" data-slot="startYear"></div>
      </div>
    </div>
    <div class="gcal-info">
      <div class="gcal-time" data-slot="timeRange" data-remove-empty></div>
      <h3 class="gcal-title" data-slot="summary"></h3>
      <div class="gcal-description" data-slot="description" data-html data-remove-empty></div>
      <div class="gcal-location" data-slot="locationBlock" data-html data-remove-empty></div>
    </div>
  </div>
</template>
```

CSS hides the date pill on continuation rows and tightens the divider:

```css
.gcal-continuous-day              { border-top: none; }
.gcal-continuous-day .gcal-day    { display: none; }
.gcal-continuous-day .gcal-info   { border-top: 1px solid var(--gcal-border); }
```

Events whose `location` field is empty drop the whole `gcal-location`
block (via `data-remove-empty`), so authors can inline an "Ort:" line
in the description for venues the calendar entry doesn't geocode.

## Server-side rendering (SSG)

Everything above runs in the visitor's browser. `@copperdesign/gcal/node`
does the same work on your build machine instead.

**Why you'd want that:**

- **No consent gate.** The browser path sends the visitor's IP to Google,
  which under § 25 TTDSG / GDPR needs informed consent — hence the
  click-to-load button in [Consent flow](#consent-flow). Fetch at build
  time and no visitor ever contacts Google, so there is nothing to
  consent to.
- **The events actually exist in the HTML.** Client-side, the shipped
  page contains an empty `<div>`. Search crawlers, LLMs, and a screen
  reader before opt-in all see nothing. This is often the bigger win, and
  it's what makes [`schema.org/Event` markup](#structured-data-schemaorgevent)
  possible at all.
- **No API key in page source.** The key lives in a CI secret.
- **One API call per day, not per visitor.**

The trade: events change only when you rebuild. For a calendar of public
appointments that's fine; for something updating hourly, stay client-side.

> Not applicable to the [Weebly drop-in](#drop-in-weebly-no-build-step)
> path — that has no build step to hook into.

### The surface

```js
import {
  fetchAllEvents,       // every page of the calendar (fetchEvents caps at one)
  normalizeEvents,      // → a stable, minimal array
  serializeArtifact,    // → the exact JSON text to write
  startOfDay,           // → a timeMin that doesn't drift
  renderEventsToString, // → HTML
  escapeHtml, escapeAttr,
  formatEventDates,     // same formatter the browser path uses
  inclusiveEndDate,     // → the last date an event actually covers
  plainText,            // → HTML description flattened to text
  provenanceComment,    // → an HTML comment naming what built this
  detectBuildTrigger,   // → 'calendar-trigger' | 'nightly-cron' | …
} from '@copperdesign/gcal/node';
```

Nothing DOM-bound is reachable from this entry point, so it imports
cleanly in plain Node 18+ with no shim.

### Provenance: telling from the HTML what produced it

Three things can put a calendar on a page — a browser fetch, a build fired
by a calendar edit, or a build fired by the nightly cron — and from the
outside they look identical. That makes "this page looks stale, which half
is broken?" much harder to answer than it should be, so both paths leave a
marker.

**Browser path.** `GCal` sets `data-gcal-render="client"` on your target
element, before the first paint and on every path — including the consent
CTA and the error state, which are exactly the states you inspect when
something looks wrong. `unmount()` removes it again.

```html
<div id="events" data-gcal-render="client">…</div>
```

**Build-time path.** `provenanceComment()` returns a comment you place
wherever you want it. The library doesn't inject it — same position it
takes on all markup.

```js
import { provenanceComment, renderEventsToString } from '@copperdesign/gcal/node';

const html = provenanceComment() + renderEventsToString(events, { row });
// <!-- gcal · server-rendered · nightly-cron -->
```

The trigger comes from `GITHUB_EVENT_NAME`, which Actions sets on every
run, so the comment distinguishes the two build paths without any wiring
on your side:

| CI event | Reported as |
|---|---|
| `repository_dispatch` | `calendar-trigger` |
| `schedule` | `nightly-cron` |
| `workflow_dispatch` | `manual` |
| `push` | `push` |
| *anything else, in CI* | `ci` |
| *no CI at all* | `local` |

Pass `{ trigger }` to override it if you build somewhere other than
Actions, and `{ at }` for a timestamp — opt-in, because a timestamp makes
every build differ from the last, which is unhelpful if you diff your
built output.

> **None of this goes in the artifact**, and that's the constraint the
> design is shaped by. A trigger name or timestamp in the JSON would make
> a cron run and a dispatch run differ byte-for-byte over an identical
> calendar, the deploy gate would fire on every alternation, and the
> [determinism contract](#determinism-and-why-you-should-care) the whole
> sync rests on would be gone. Provenance describes the *render*, so it
> lives in rendered output and nowhere else.

There's no version number in the marker on purpose. The only version
string in `src/` is the banner, kept in step by `scripts/stamp-banners.mjs`
and asserted by CI; a second one would be a second thing to keep in sync,
and it would go stale quietly.

### Determinism, and why you should care

`normalizeEvents` guarantees that **the same calendar produces the same
bytes every time** — same fields, same key order, same element order,
regardless of what order the API returned things in or when you called
it. It drops `etag`, `updated`, `created`, `iCalUID`, `sequence` and
friends, all of which change without the event changing.

That's not tidiness. It's what lets you commit the artifact and have
`git diff --quiet` mean "the calendar didn't change" — which is the
whole basis of the nightly sync below. Get it wrong and every site
using this redeploys every night, forever, for nothing.

The same reasoning is why `startOfDay` exists. Passing
`new Date().toISOString()` as `timeMin` — correct for the browser —
puts a fresh timestamp in every request, so events near the boundary
flicker in and out and the artifact churns. Floor it to the start of the
day, **in the calendar's own time zone**: a job at 01:00 UTC is already
03:00 in Berlin, and a UTC floor would drop events still happening
locally today.

### Fetching

Use [the CLI](#nightly-sync-with-github-actions) unless you have a
reason not to. Directly, it's:

```js
import { fetchAllEvents, normalizeEvents, serializeArtifact, startOfDay }
  from '@copperdesign/gcal/node';
import { writeFile } from 'node:fs/promises';

const events = await fetchAllEvents({
  calendarId: 'you@example.com',
  apiKey:     process.env.GCAL_API_KEY,
  timeMin:    startOfDay('Europe/Berlin'),
});

await writeFile('src/content/kalender.json', serializeArtifact(normalizeEvents(events)));
```

### Rendering

The artifact is `{ schemaVersion, events }`. Your build reads it and
produces markup — the library still ships no opinion about what that
markup is:

```js
// scripts/render-calendar.mjs — runs during your build
import { readFile } from 'node:fs/promises';
import { renderEventsToString, formatEventDates, escapeHtml, escapeAttr }
  from '@copperdesign/gcal/node';

const { events } = JSON.parse(await readFile('src/content/kalender.json', 'utf8'));
const dayKey = (e) => (e.start.dateTime ?? e.start.date).slice(0, 10);

const html = renderEventsToString(events, {
  empty: '<p class="gcal-state">Keine aktuellen Termine.</p>',
  wrap:  (rows) => `<div class="gcal">${rows}</div>`,

  // `row` receives (event, index, all) — so neighbour-aware markup like
  // the continuous-day modifier from the recipe above works here too,
  // without re-implementing the loop.
  row: (event, i, all) => {
    const d = formatEventDates(event, { locale: 'de-DE', timeZone: 'Europe/Berlin' });
    const continuous = i > 0 && dayKey(all[i - 1]) === dayKey(event);

    // Omit empty nodes rather than emitting them hollow — this is the
    // build-time equivalent of `data-remove-empty` in the browser template.
    const time = event.allDay ? '' :
      `<p class="gcal-time">${escapeHtml(d.startTime)} bis ${escapeHtml(d.endTime)} Uhr</p>`;
    const description = event.description
      ? `<div class="gcal-description">${event.description}</div>`
      : '';
    const location = event.location
      ? `<p class="gcal-location"><b>Ort:</b> <a href="https://maps.google.com/maps?q=${
          encodeURIComponent(event.location)}">${escapeHtml(event.location)}</a></p>`
      : '';

    return `<article class="gcal-row${continuous ? ' gcal-continuous-day' : ''}">
      <time class="gcal-day" datetime="${escapeAttr(event.start.date ?? event.start.dateTime)}">
        <span class="gcal-dm">${escapeHtml(d.startMonth)}</span>
        <span class="gcal-dd">${escapeHtml(d.startDay)}</span>
        <span class="gcal-dy">${escapeHtml(d.startYear)}</span>
      </time>
      <div class="gcal-info">
        ${time}
        <h2 class="gcal-title">${escapeHtml(event.summary.trim())}</h2>
        ${description}
        ${location}
      </div>
    </article>`;
  },
});
```

Same CSS as the browser recipe — the class contract is identical, so a
site can move from one path to the other without touching its stylesheet.

Four details in there are deliberate, and they're the reason to start from
this snippet rather than a `<div>` soup of your own:

- **`<time datetime="…">`** carries the machine-readable date. The browser
  renderer *can't* do this — [one binding per node](#template-binding)
  forbids putting both a `datetime` attribute and a text label on the same
  element — so this is a real capability you only get at build time. Take
  it.
- **`<article>` and `<h2>`** over `<div>` and `<h3>`. Pick the heading level
  that doesn't skip one relative to your page's `<h1>`; if the listing sits
  directly under the page title, that's `<h2>`. Heading structure is the
  cheapest strong signal you can give a crawler or a screen reader, and it
  is the single thing most often got wrong in generated markup.
- **Empty nodes are omitted**, not emitted hollow. Most calendars have no
  description on most events.
- **`summary.trim()`** — Google's UI silently swallows leading whitespace in
  a title, so calendars accumulate it. It renders as a visibly indented
  heading.

**On escaping:** `summary` and `location` are text and must be escaped.
`description` is deliberately *not* — Google returns real HTML in that
field, and escaping it would visibly break every event that uses
formatting. That asymmetry is intentional; treat `description` as
trusted content from your own calendar, because that's what it is. Use
`escapeAttr` for anything interpolated into an attribute value.

### Structured data (`schema.org/Event`)

Rendering server-side is what makes this possible at all — you can't
usefully emit JSON-LD for events that only exist after a client-side
fetch. It is also most of the reason to bother moving.

The library does **not** emit this for you, and won't: markup is the
consumer's business, same as everywhere else here. What follows is a
correct starting point and, more importantly, the two things that
silently make it worthless.

#### `location` is required, not recommended

> **Google will not surface an event without a `location`.** Not "less
> prominently" — at all. It sits alongside `name` and `startDate` as a
> required property, and everything else on this page is wasted effort
> until it's populated.

This bites harder than it sounds, because of how people actually keep
calendars. A calendar maintained by a human for humans routinely puts the
venue in the **title** —

> `Kultur im Koffer: Die Beatles. Kirchengemeinde Schiffbek und Öjendorf`

— and leaves Google's own **Location** field empty. That reads perfectly
in the Calendar UI and on your rendered page, and it is invisible to a
crawler, which sees one opaque string. The first real site to run this
path had venues in the title on **10 of 10 events** and `location` set on
**none** of them.

So before writing any of the markup below, check the data:

```js
const { events } = JSON.parse(await readFile('src/content/kalender.json', 'utf8'));
const missing = events.filter((e) => !e.location).length;
if (missing) console.warn(`gcal: ${missing}/${events.length} events have no location — not eligible for Google Events`);
```

If that number isn't zero, the fix is in the calendar, not in your build.
Worth putting in front of whoever maintains it before you ship anything
that depends on it.

#### All-day `endDate` is off by one

Google's all-day `end.date` is **exclusive** — a one-day event on the 5th
comes back as `end.date: "2026-09-06"`. schema.org's `endDate` is
**inclusive**. Publish the raw value and every event is advertised as a
day longer than it is: a wrong date in a rich result, which is worse than
no rich result. Timed events need no correction.

Since 0.3.0 this ships from `/node`, so it doesn't have to be rewritten
per site:

```js
import { inclusiveEndDate } from '@copperdesign/gcal/node';

inclusiveEndDate({ end: { date: '2026-09-06' } });   // → '2026-09-05'
inclusiveEndDate({ end: { dateTime: '2026-06-12T21:00:00+02:00' } });
                                                     // → unchanged
```

It takes a raw or a normalized event — `end` alone is authoritative — and
returns `''` when there's no end at all.

**The rendered output needs no correction of its own.** `formatEventDates`
applies the same shift internally as of 0.3.0, so a one-day event prints
as `"15. Juni 2026"` rather than a two-day range. This helper is for the
places you build from normalized events directly, JSON-LD being the main
one.

#### The block

```js
// Appended after the rows, inside the same generated partial.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',                                    // a listing page, so ItemList
  itemListOrder: 'https://schema.org/ItemListOrderAscending',
  numberOfItems: events.length,
  itemListElement: events.map((event, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Event',
      name:      event.summary.trim(),                     // required
      startDate: event.start.dateTime ?? event.start.date, // required
      location:  event.location                            // required — see above
        ? { '@type': 'Place', name: event.location }
        : undefined,
      endDate:   inclusiveEndDate(event),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      url:   `https://example.com/termine#${anchorFor(event)}`,
      image: 'https://example.com/assets/og-default.jpg',
      description: plainText(event.description) || undefined,
      performer: { '@id': 'https://example.com/#person' },
    },
  })),
};

const html = `${rows}\n<script type="application/ld+json">\n${
  JSON.stringify(jsonLd, null, 2)}\n</script>`;
```

`plainText` ships from `/node` as of 0.3.0 — import it alongside
`inclusiveEndDate`. It strips tags, decodes the entities Google actually
emits (`&amp;` `&lt;` `&gt;` `&quot;` `&#39;` `&nbsp;`), and collapses
whitespace. Accented characters come back as literal UTF-8 from Google, so
a full entity table isn't carried; anything else passes through untouched.

`anchorFor` is still yours to write — a slug from the date plus the title.
It stays out of the library because the shape of an anchor is a URL
decision, and URLs are the consumer's namespace.

Notes on the properties that aren't obvious:

- **`description` needs to be plain text.** `event.description` is HTML by
  design (see the escaping note above), and HTML in a JSON-LD string
  property is wrong. Strip tags and decode entities.
- **`url` wants a per-event target.** A dedicated page per event is what
  Google actually prefers; a fragment anchor on the listing (`#…`) is the
  cheap version and is much better than omitting it. Don't generate a page
  per event *just* for this if the events carry nothing but a title and a
  date — thin pages are their own problem.
- **`image` is recommended and matters.** If there's no per-event artwork,
  a single site-wide fallback is legitimate.
- **`performer` yes, `organizer` usually no.** For an author's readings the
  venue organizes and the author performs. Asserting both because both
  fields exist is a false statement in machine-readable form, which is
  worse than an absent optional property.
- **`undefined` values disappear** through `JSON.stringify`, so the
  conditionals above need no extra guarding.

Validate the result against the
[Rich Results Test](https://search.google.com/test/rich-results) once
real data is flowing — `location` in particular fails loudly there, which
is the fastest way to get the calendar fixed.

## Nightly sync with GitHub Actions

The pipeline, end to end:

```
cron → fetch → normalize → write JSON → commit
                                          ↓
                    your existing build → reads JSON → HTML → deploy
```

Two separate concerns. The sync owns **data**; your existing pipeline
owns **building and deploying**. They meet at a committed file and
nowhere else.

If you're coming from a git-backed CMS, this is the same shape you
already have: a CMS editor doesn't render anything either — it commits
files, and your build turns them into HTML. Here the committing is done
by a cron instead of a person. **A CMS is not required and not
involved.**

### The short version

Add a config file and a workflow. That's it.

`gcal.config.json`:

```json
{
  "calendarId": "you@example.com",
  "timeZone":   "Europe/Berlin",
  "out":        "src/content/kalender.json"
}
```

`maxResults` (page size) and `timeMax` are optional. The API key is
**not** a config field — it comes from `GCAL_API_KEY`, because this file
gets committed and a key in it is rejected outright.

```yaml
# .github/workflows/sync-calendar.yml
name: Sync calendar
on:
  schedule:
    - cron: '0 1 * * *'    # see "scheduling" below — this time matters
  workflow_dispatch:

jobs:
  sync:
    uses: copperdesign/gCal/.github/workflows/sync.yml@v0.5.1
    permissions:
      contents: write        # the sync job pushes the commit — see below
    with:
      config: gcal.config.json
    secrets:
      api-key: ${{ secrets.GCAL_API_KEY }}
```

Pin the tag, not `@master` — that workflow changes with the CLI it runs.
Your repo needs `@copperdesign/gcal` as a dependency, a
`package-lock.json`, and the [server-side API key](#4-a-second-key-for-server-side-use).

> **`permissions` on the calling job is not optional.** A called workflow
> inherits the token of the job that called it and can't ask for more, so
> the write it needs to push has to be granted *there*. Leave it out and
> the run fails as a `startup_failure` — no job, no step, no log to read —
> on any repository whose default workflow token is read, which is the
> default for everything created since February 2023. (Fixed in 0.5.1;
> earlier tags declared the write inside the workflow, where it acted as a
> ceiling check and failed the same way, with nothing you could add on
> your side to satisfy it.)
>
> Under [`commit: false`](#owning-the-commit-deploy-first-commit-after)
> nothing in the sync job pushes, so grant it nothing — the write belongs
> on whichever job of yours does the committing.

Prefer to own it? `npx gcal-sync --config gcal.config.json` is the whole
job; run it from a workflow of your own.

A nightly cron means an edit made this morning appears tomorrow. If
that's too stale — and on a calendar-led site it usually is — see
[instant updates](#instant-updates-let-the-calendar-trigger-the-sync),
which trades the cron for a trigger fired by the calendar itself. It's
both faster and cheaper in Actions minutes than a tighter cron.

### Outputs: gating your own deploy

The workflow syncs and commits, and stops there — baking a deploy in
would tie it to one host. What it does hand back is what it already
knows, so your pipeline can decide for itself:

| Output | Value |
|---|---|
| `changed` | `'true'` when the artifact changed — and was committed, unless you set `commit: false`. `'false'` otherwise |
| `events` | Number of events in the artifact; empty when no artifact exists |
| `out` | Path the artifact was written to, read from your config |
| `artifact` | Name of the uploaded run artifact — set only under `commit: false`, and only when something changed |

```yaml
jobs:
  sync:
    uses: copperdesign/gCal/.github/workflows/sync.yml@v0.5.1
    permissions: { contents: write }
    with:     { config: gcal.config.json }
    secrets:  { api-key: ${{ secrets.GCAL_API_KEY }} }

  deploy:
    needs: sync
    if: needs.sync.outputs.changed == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      # …your build and deploy, whatever the host
```

That keeps the separation intact — the workflow still has no idea what a
deploy is — while removing the reason to fork it. On a quiet night the
`deploy` job is skipped outright rather than rebuilding and re-uploading
bytes that didn't move.

`changed` is `'true'` only after the push succeeds. If the push fails the
job fails, and a deploy gated on the output correctly doesn't run — the
branch doesn't have the artifact, so there is nothing to deploy yet.

### Owning the commit: deploy first, commit after

The default order is commit, then deploy. Both orders can fail. Only one
of them heals.

- **Commit first, deploy second** — the push lands, the deploy breaks.
  Git now records the new calendar, so *tomorrow's* run finds no diff,
  reports `changed: 'false'`, and never retries. The live site is stale
  and stays stale, with one red run days ago as the only signal and every
  run since green.
- **Deploy first, commit second** — the deploy lands, the commit breaks.
  The site is current, git is briefly behind, and tomorrow's run sees the
  same diff, redeploys, and pushes. **It fixes itself.**

`commit: false` buys the second order. The job fetches, writes, and
reports `changed` — on the diff alone now, since there's no push left to
wait on — then stops short of committing and uploads the artifact to the
run instead. Your next job gets a fresh runner and an empty workspace, so
the file has to travel somehow. You download it, deploy it, and make the
commit yourself, once the thing is actually live:

```yaml
jobs:
  sync:
    uses: copperdesign/gCal/.github/workflows/sync.yml@v0.5.1
    # No permissions block: this job fetches and decides, and never
    # pushes. Don't hand a write token to a job that talks to the
    # open internet when it has nothing to write.
    with:
      config: gcal.config.json
      commit: false
    secrets:
      api-key: ${{ secrets.GCAL_API_KEY }}

  deploy:
    needs: sync
    if: needs.sync.outputs.changed == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write            # the commit is yours now, so is the token
    steps:
      - uses: actions/checkout@v6

      - uses: actions/download-artifact@v8
        with:
          name: ${{ needs.sync.outputs.artifact }}
          path: src/content      # the artifact's DIRECTORY — see below

      # …your build and deploy, whatever the host

      - name: Commit the calendar now that it's live
        run: |
          git config user.name  'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add -- '${{ needs.sync.outputs.out }}'
          git commit -m 'chore: sync calendar'
          git push
```

> **`path:` wants the artifact's directory, not its path.**
> `upload-artifact` roots a single-file artifact at that file's own
> folder, so the archive holds `kalender.json`, not
> `src/content/kalender.json`. Point `path:` at `src/content` and it
> lands where your build looks for it. Point it at `.` and it lands at
> the repo root, where nothing reads it — and the build quietly uses the
> older committed copy instead, which looks exactly like success.

On a `repository_dispatch` run, check out the branch explicitly as
described [below](#instant-updates-let-the-calendar-trigger-the-sync) —
a detached `HEAD` has nowhere to push that commit to.

**Use the default unless your deploy is a job in your own workflow.** If
your host builds from a webhook (Cloudflare Pages, Netlify, Vercel), the
commit *is* the deploy trigger; `commit: false` would leave the site
waiting for a push that never comes. This trade only exists for
pipelines that deploy from Actions, where you can put the two steps in
either order.

### Fail-soft: a bad night at Google must not fail your build

By default, a failed fetch **logs, leaves the committed artifact
untouched, and exits 0**. Yesterday's calendar is a far better outcome
than a red build or a blank page, and the situation resolves itself
tomorrow without anyone being paged.

Two cases, distinguished in the log because they need different
reactions:

- an artifact exists → the site keeps yesterday's calendar, nobody needs
  to do anything tonight;
- no artifact exists → your build is about to hit a missing file, and
  that gets a much louder line.

`--strict` (or `strict: true` on the workflow) opts into a non-zero exit
instead. **Configuration errors are never soft**: an unknown flag, a
malformed config, a missing `GCAL_API_KEY`, an unwritable output path —
all exit 1 with or without `--strict`, because none of them will fix
themselves by morning. An `apiKey` found *inside* the config file is
rejected outright rather than warned about; a key in a committed file is
exactly the mistake this is trying to prevent.

### Scheduling: the part that catches people out

**A push made with `GITHUB_TOKEN` does not trigger other GitHub Actions
workflows.** That's deliberate on GitHub's part — it's what stops a
committing workflow from re-triggering itself forever — but it means
**the sync's commit will not start your deploy workflow.**

- **Deploying from GitHub Actions** (Firebase, rsync, most setups):
  schedule the sync *ahead of* your deploy job's own cron and let the
  deploy pick up the committed file. Fifteen minutes is plenty. Expecting
  the commit to chain leaves your calendar silently never deploying —
  no error, no red run, just a page that quietly goes stale.
- **Deploying from a host that watches the repo** (Cloudflare Pages,
  Netlify, Vercel): those build from a webhook, not from an Actions
  workflow, so this restriction doesn't apply and the commit should
  trigger a build directly. GitHub scopes the rule to workflow runs
  specifically, and Cloudflare documents no bot-commit exclusion — but
  verify it on your own project before relying on it. If it doesn't
  fire, add a [Deploy Hook](https://developers.cloudflare.com/pages/configuration/deploy-hooks/)
  call as a final step in the sync workflow.

> **Keep skip-CI markers out of the commit message.** Suppressing CI on
> a bot commit is a natural instinct, and here it silently breaks the
> thing you're building.
>
> Both platforms honour them. GitHub Actions skips `push` and
> `pull_request` runs on `skip ci`, `ci skip`, `no ci`, `skip actions`
> or `actions skip` (in square brackets); Cloudflare Pages skips a build
> on `CI Skip`, `Skip CI` or `CF-Pages-Skip`. Either way your calendar
> commits every night and deploys never — no error, no red run.
>
> The nasty part: the match is **anywhere in the message, not just the
> subject line**. A commit whose body merely *mentions* one of these
> markers — a changelog entry, a note like this one — skips its own run.
> That is not hypothetical; the commit adding this paragraph did exactly
> that.
>
> The default message (`chore: sync calendar`) is safe. If you override
> `commit-message`, keep it clear of those markers.

### Instant updates: let the calendar trigger the sync

A nightly cron means an event added at 09:00 doesn't show up until
tomorrow. For a site whose calendar *is* the content, that's usually the
wrong trade — and the fix is cheaper than tightening the cron, not more
expensive.

**Polling is the costly architecture.** GitHub Free includes 2,000
Actions minutes a month on private repositories (public repos are
unmetered), billed per run and rounded up. A sync run — checkout,
`setup-node`, `npm ci`, fetch — is one to two billable minutes. So a
`*/15` cron burns 2,000–4,000 minutes a month to discover, almost every
time, that nothing changed. Hourly costs 500–1,000. Both spend the quota
on *asking*.

A push-triggered sync runs only when the calendar actually changes — ten
to twenty times a month for a typical site, so twenty to forty minutes,
and near-instant instead of up to a day stale. Cheaper *and* faster,
which is why this is the recommended shape on a private repo.

#### Why not Google's own push notifications?

The Calendar API does have [push notifications](https://developers.google.com/workspace/calendar/api/guides/push)
(`events.watch`). They're the wrong tool here, on three counts:

- **OAuth 2.0 is required.** A watch request needs a bearer token for a
  user who owns or can access the resource. This library's entire auth
  model is a restricted API key against a *public* calendar.
- **You must run an HTTPS server** with a valid, trusted certificate to
  receive them — the runtime dependency this whole approach exists to
  remove.
- **Channels expire, with no auto-renew.** In Google's words: "there's no
  automatic way to renew a notification channel." You would need a cron
  to re-`watch` — a cron, plus a server, plus OAuth, in order to avoid a
  cron.

Worth knowing either way: the notification carries no body. It's a bare
ping, and you still call the API for the data. Push only ever replaces
the *trigger*, never the work.

#### Apps Script instead: Google-native, nothing to host

Apps Script has an `onEventUpdated` installable trigger that fires when a
calendar entry is created, edited, or deleted. Apps Script *is* the
hosted runtime, so there's nothing to deploy or keep alive, and it runs
as an authorized Google user — the OAuth problem collapses into clicking
*Allow* once. It's free: the consumer-account budget is 90 minutes of
total trigger runtime per day, against a script that runs for about a
second.

Like Google's own push, the trigger reports *that* the calendar changed,
not what changed. That suits us exactly — the sync refetches wholesale
anyway.

The shape of it: a trigger bound to the calendar posts a
`repository_dispatch` to GitHub, which starts your sync workflow. The
credentials live in Script Properties — a fine-grained PAT scoped to the
one repository with **Contents: read and write**, which is exactly what
`POST /repos/{owner}/{repo}/dispatches` requires and nothing more.

> **📖 Step-by-step setup: [`docs/instant-updates.md`](docs/instant-updates.md)**
>
> The token, the Apps Script project, the trigger, the test — about fifteen
> minutes, once. Full script, and a troubleshooting table for the handful of
> ways it goes wrong (a `404` means the token can't see the repo; a dispatch
> with no workflow run means the trigger isn't on your default branch yet).

The rest of this section is what that walkthrough assumes you've already
decided — worth reading first if you haven't.

**The workflow side.** Add `repository_dispatch` to the wrapper from
[the short version](#the-short-version). **Keep the cron** — it is not
made redundant by the trigger, for the reason below:

```yaml
# .github/workflows/sync-calendar.yml
name: Sync calendar
on:
  repository_dispatch:
    types: [calendar-changed]   # matches event_type in the script
  schedule:
    - cron: '0 1 * * *'         # NOT optional — see below. ~30 runs/month
  workflow_dispatch:            # manual re-run

jobs:
  sync:
    uses: copperdesign/gCal/.github/workflows/sync.yml@v0.5.1
    permissions:
      contents: write
    with:
      config: gcal.config.json
    secrets:
      api-key: ${{ secrets.GCAL_API_KEY }}
```

#### The cron is not a fallback — keep it either way

The natural reading is "the trigger replaced the cron, and the cron is
now just insurance". That's wrong, and the second reason below is
structural rather than defensive.

**1. Past events expire by the passage of time, not by an edit.** The CLI
floors `timeMin` to the start of today, so an event that has happened
drops out of the fetch window *on its own* — the artifact changes with no
calendar edit whatsoever. But the trigger only ever fires on edits.
Without the cron, a concert that happened last week sits on the page
until the next time somebody happens to touch the calendar, which on a
stable calendar could be months. **Nothing else expires past events.**

**2. Both moving parts fail silently.** Apps Script disables triggers
that error repeatedly, mailing only the *script's owner* — which may not
be you. Fine-grained PATs expire within a year. In both cases dispatches
simply stop, the site reverts to being up to a day stale, and nothing
goes red. The failure mode is "it quietly got slower again", which nobody
notices for weeks.

So: trigger for speed, cron for correctness. The pair lands comfortably
under 100 minutes a month, and the reusable workflow's concurrency group
already serialises a dispatch that lands mid-cron, so they can't race.

#### The bonus: the chaining problem disappears

A dispatch-triggered run is *your* workflow run, so it can sync **and**
deploy in the same job. The `GITHUB_TOKEN` restriction described above
simply stops applying — no scheduling gap to tune, no waiting for the
deploy's own cron.

**Gate the deploy on `changed` anyway.** It's tempting to deploy
unconditionally in a dispatch run on the grounds that the run only exists
because the calendar changed — but a dispatched run producing a
byte-identical artifact is *common*, not a rare edge case. The trigger
fires on any calendar edit at all, while the artifact carries only the
eight fields in `EVENT_FIELDS`. Add a guest, change an event's colour,
set a reminder, edit something outside the fetch window: the trigger
fires, the artifact doesn't move. The nightly backstop run is the same
story by definition.

So the two mechanisms do different jobs and you want both — the trigger
decides *how often you run*, `changed` decides *whether you deploy*:

```yaml
  deploy:
    needs: sync
    if: needs.sync.outputs.changed == 'true'
```

> **Check out the branch tip, not the triggering commit.** For a
> `repository_dispatch` event, `github.sha` is the default branch as it
> was *when the event fired* — before the sync's commit exists. A deploy
> job using a bare `actions/checkout` will therefore build the calendar
> as it was **before** the edit that triggered the run, and look
> perfectly healthy doing it. Pass the branch explicitly:
>
> ```yaml
>   deploy:
>     needs: sync
>     runs-on: ubuntu-latest
>     steps:
>       - uses: actions/checkout@v6
>         with:
>           ref: ${{ github.event.repository.default_branch }}
> ```

#### Whose Google account runs it

Cleanest is **yours**, not the client's: subscribe to their public
calendar and point `forUserCalendar(calendarId)` at it, and they never
have to touch a script, a token, or a Google consent screen. Verify the
trigger genuinely fires for a subscribed calendar on your own setup
before relying on it — if it doesn't, the script has to live in the
calendar owner's account instead, which is a one-time setup rather than
an ongoing burden.

Two things to know before you rely on this:

- **The PAT expires.** Fine-grained tokens cap at one year. When it
  lapses the dispatch starts failing and edits stop appearing instantly —
  the nightly cron keeps the site correct, which is the good news and
  also why nobody notices. Put the rotation in a calendar.
- **Apps Script disables triggers that keep failing**, emailing the
  script's owner. Same story: the cron covers you, so treat those emails
  as real.

### Host notes

Nothing about the sync is host-specific — it writes a file and commits
it. What differs is what your host does next.

**Firebase Hosting.** Two extra considerations, both real:

1. The scheduling gap above applies, since deploys run in Actions.
2. **Gate your deploy on `changed`.** Hosting retains every deployed
   version and each counts in full against the 10 GB storage quota, with
   no cross-version dedup. An unconditional nightly deploy adds 365
   versions a year — for a 13 MB site that's ~4.7 GB of identical bytes
   annually, and the Spark plan is gone in about two years of nothing
   happening. One `if:` prevents all of it:

   ```yaml
     deploy:
       needs: sync
       if: needs.sync.outputs.changed == 'true'
   ```

   Earlier versions of this note recommended fingerprinting the payload
   and keying an `actions/cache` entry on the hash. That works, but it's a
   lot of machinery for something an output does for free — and it has a
   trap: if your build stamps a date or a commit SHA into its output (a
   footer, a meta tag), the fingerprint changes every night by
   construction and the gate never closes. You'd have to hash the build
   *inputs* instead, which is fiddly to get right. Gate on `changed`
   instead; it's decided before any of your build steps run.

**Cloudflare Pages.** Simpler, as it happens: no scheduling gap (see
above), and no retention quota of Firebase's kind — the relevant free
limit is builds per month (500) against roughly 30 for a nightly sync,
so **no fingerprint gate is needed**. Because the CLI doesn't write when
nothing changed, a quiet night commits nothing and burns no build at
all. Set `NODE_VERSION` to 18 or higher in the Pages build environment.

**Anything else** — Netlify, Vercel, plain rsync, a Makefile — follows
the generic pipeline unchanged. The sync commits a file; whatever you
already do with committed files still applies.

**Not recommended: a Cloudflare Workers Cron Trigger.** It can fetch on
a schedule, but it can't commit to git or rebuild static HTML, so you'd
end up serving from KV at request time — reintroducing exactly the
runtime dependency this whole approach removes. Keep the cron in GitHub
Actions regardless of where you host.

### Where to put the artifact

One JSON file, committed. That is the recommended shape, and it is what
the CLI produces.

You *can* fan it out into per-event content files so a CMS can edit
them — but think about ownership first. A generated file that an editor
edits gets overwritten on the next sync, silently, unless you design an
explicit overlay: a stable key, a separate place for the human-authored
fields, and a merge step. That's a real feature, not a config flag. Start
with the single JSON file; split it only when someone actually asks to
enrich an event.

Do not register the artifact as an editable CMS collection. It is
machine-owned.

## Browser support

Applies to the browser entry (`@copperdesign/gcal`). Modern evergreens. Requires native `fetch`, `Intl.DateTimeFormat`, `<template>`, `URLSearchParams`. No build step required.

The `/node` entry point requires Node 18 or newer and is tested against 18, 20 and 22.

## Provenance

This module is the modern successor to a pair of older scripts — a 2018 jQuery plugin and a later vanilla rewrite — that rendered the same Google Calendar pattern in production. The current rewrite splits rendering from data, drops the bundled Steven Levithan dateFormat library in favor of `Intl`, and makes consent gating a contract rather than a built-in.

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
the PR workflow, and what fits the scope of the module. The repo follows
the [Contributor Covenant](CODE_OF_CONDUCT.md).

Quick version: fork, branch off `master`, exercise your change against
`test/index.html` (offline) and `demo/index.html` (live API) in at least
one non-Chromium browser, open a PR. I (@copperdesign) review and merge.

## Releasing (maintainer notes)

The package is published to npm as
[`@copperdesign/gcal`](https://www.npmjs.com/package/@copperdesign/gcal)
and installable in any project with:

```sh
npm install @copperdesign/gcal
```

For future releases:

```sh
npm version patch        # or minor / major — bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
gh release create vX.Y.Z --generate-notes
```

The `release.yml` GitHub Actions workflow handles the rest: it
smoke-checks every `src/*.js` and `bin/*.mjs`, runs the full test suite,
verifies the tag matches `package.json`, confirms every `exports`
subpath resolves and actually ships in the tarball, and publishes to npm
with provenance. Requires an `NPM_TOKEN` repo secret minted from the
`copperdesign` npm account.

**The tag is load-bearing beyond npm.** Consumers reference the reusable
sync workflow as
`copperdesign/gCal/.github/workflows/sync.yml@vX.Y.Z`, which resolves
against the git tag — so a release that publishes to npm without pushing
the tag leaves every consuming site's sync job unable to resolve its
`uses:` line. `git push --follow-tags` before `gh release create`.

## License

MIT — see [LICENSE](./LICENSE).

Created by [Christian Fillies](https://www.christianfillies.com).
