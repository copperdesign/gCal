# @copperdesign/gcal

[![npm version](https://img.shields.io/npm/v/@copperdesign/gcal.svg)](https://www.npmjs.com/package/@copperdesign/gcal)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@copperdesign/gcal)](https://bundlephobia.com/package/@copperdesign/gcal)
[![license](https://img.shields.io/npm/l/@copperdesign/gcal.svg)](./LICENSE)

Render a public Google Calendar into HTML you control. Template-driven, locale-aware, consent-friendly. Zero dependencies, ESM only.

```bash
npm install @copperdesign/gcal
```

## What it does

You point it at a public Google Calendar and an HTML `<template>`. It fetches events from the Calendar v3 API, clones the template per event, fills `data-slot` attributes with event fields, and appends them to a target element.

That's it. No framework, no virtual DOM, no jQuery. ~7KB unminified.

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
{
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
}
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
    <p>Beim Laden des Kalenders werden Daten an Google übertragen.</p>
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
cal.renderItems([{ summary: '…', start: {…}, end: {…} }]);

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

## Browser support

Modern evergreens. Requires native `fetch`, `Intl.DateTimeFormat`, `<template>`, `URLSearchParams`. No build step required.

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
smoke-checks every `src/*.js`, verifies the tag matches `package.json`,
confirms every `exports` subpath resolves, and publishes to npm with
provenance. Requires an `NPM_TOKEN` repo secret minted from the
`copperdesign` npm account.

## License

MIT — see [LICENSE](./LICENSE).

Created by [Christian Fillies](https://www.christianfillies.com).
