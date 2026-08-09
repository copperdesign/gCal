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
  reader before opt-in all see nothing. This is often the bigger win.
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
} from '@copperdesign/gcal/node';
```

Nothing DOM-bound is reachable from this entry point, so it imports
cleanly in plain Node 18+ with no shim.

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
    const time = event.allDay ? '' :
      `<div class="gcal-time">${escapeHtml(d.startTime)} bis ${escapeHtml(d.endTime)} Uhr</div>`;
    const location = event.location
      ? `<div class="gcal-location"><b>Ort:</b> <a href="https://maps.google.com/maps?q=${
          encodeURIComponent(event.location)}">${escapeHtml(event.location)}</a></div>`
      : '';

    return `<div class="gcal-row${continuous ? ' gcal-continuous-day' : ''}">
      <div class="gcal-cal"><div class="gcal-day">
        <div class="gcal-dm">${escapeHtml(d.startMonth)}</div>
        <div class="gcal-dd">${escapeHtml(d.startDay)}</div>
        <div class="gcal-dy">${escapeHtml(d.startYear)}</div>
      </div></div>
      <div class="gcal-info">
        ${time}
        <h3 class="gcal-title">${escapeHtml(event.summary)}</h3>
        <div class="gcal-description">${event.description}</div>
        ${location}
      </div>
    </div>`;
  },
});
```

Same CSS as the browser recipe — the class contract is identical, so a
site can move from one path to the other without touching its stylesheet.

**On escaping:** `summary` and `location` are text and must be escaped.
`description` is deliberately *not* — Google returns real HTML in that
field, and escaping it would visibly break every event that uses
formatting. That asymmetry is intentional; treat `description` as
trusted content from your own calendar, because that's what it is. Use
`escapeAttr` for anything interpolated into an attribute value.

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
    uses: copperdesign/gCal/.github/workflows/sync.yml@v0.2.0
    with:
      config: gcal.config.json
    secrets:
      api-key: ${{ secrets.GCAL_API_KEY }}
```

Pin the tag, not `@master` — that workflow changes with the CLI it runs.
Your repo needs `@copperdesign/gcal` as a dependency, a
`package-lock.json`, and the [server-side API key](#4-a-second-key-for-server-side-use).

Prefer to own it? `npx gcal-sync --config gcal.config.json` is the whole
job; run it from a workflow of your own.

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

### Host notes

Nothing about the sync is host-specific — it writes a file and commits
it. What differs is what your host does next.

**Firebase Hosting.** Two extra considerations, both real:

1. The scheduling gap above applies, since deploys run in Actions.
2. **Gate your deploy on whether the payload changed.** Hosting retains
   every deployed version and each counts in full against the 10 GB
   storage quota, with no cross-version dedup. An unconditional nightly
   deploy adds 365 versions a year and will exhaust it. Fingerprint what
   you'd upload, key an `actions/cache` entry on that hash, and deploy
   only on a miss — the determinism guarantee above is what makes the
   fingerprint stable on a quiet night. Take the fingerprint *before* any
   build step that stamps a date into your output, or it changes every
   night by construction.

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
