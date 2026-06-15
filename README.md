# @copperdesign/gcal

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

## Browser support

Modern evergreens. Requires native `fetch`, `Intl.DateTimeFormat`, `<template>`, `URLSearchParams`. No build step required.

## Provenance

This module is the modern successor to a pair of older scripts — a 2018 jQuery plugin and a later vanilla rewrite — that rendered the same Google Calendar pattern in client projects. The current rewrite splits rendering from data, drops the bundled Steven Levithan dateFormat library in favor of `Intl`, and makes consent gating a contract rather than a built-in.

## License

MIT © Christian Fillies
