# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@copperdesign/gcal` — a zero-dependency, ESM-only browser library that fetches events from the public Google Calendar v3 API and renders them into a consumer-supplied `<template>`. No build step, no framework.

Successor to a pair of older scripts (a 2018 jQuery plugin and a later vanilla rewrite) that rendered the same Google Calendar pattern in client projects. The rewrite swaps jQuery + Steven Levithan dateFormat for native `fetch` + `Intl`, and turns consent gating from a built-in into a contract.

## Running and testing

There is no test runner, no bundler, no `npm test`. Everything ships as source.

- **Smoke tests**: open `test/index.html` directly in a browser. Inline checks run on load; all rows must be green. Covers `buildEventsUrl`, `formatEventDates` (all-day, timed same-day, multi-day), the template renderer, and `GCal.renderItems`. No network calls — `GCal.renderItems` is exercised offline so it doesn't need a real calendar.
- **Demo**: open `demo/index.html` in a browser, paste a real Calendar ID + API key, opt in. This is the only path that hits the live Google API.
- **Adding tests**: extend `test/index.html` with another numbered block using the existing `check(label, condition, detail)` helper. Keep the offline-by-default property — only `demo/` should hit the network.

## Architecture

Five files in `src/`, four primitives plus one facade:

- `fetch.js` — `buildEventsUrl()` (pure, no network, tested independently) + `fetchEvents()` (thin wrapper). No retry, no caching by design — the rendering loop is "fetch → render once".
- `dates.js` — `formatEventDates(event, { locale, timeZone, connectors })`. Intl-based. Returns both a composed sentence (`dates`) and structured parts (`startDay`, `startMonth`, `startTime`, …). Connectors (`bis` / `um` / `Uhr`) are German by default but pluggable. `Intl.DateTimeFormat` instances are cached per `(locale, timeZone)` pair because constructing them is expensive when rendering many events.
- `template.js` — `resolveTemplate()` (accepts element / selector / HTML string) + `renderTemplate()`. Binding contract is three attributes on slot nodes: `data-slot="key"` (textContent), `+ data-html` (innerHTML, trusted), `+ data-attr="href"` (setAttribute). Missing data → `hidden` attribute by default, or full removal with `data-remove-empty`. **One binding rule per node** is a deliberate constraint — split into child nodes if you need both attr and label.
- `consent.js` — `renderConsentCTA()`. Provider-agnostic: the library never imports a consent SDK. Consumers pass `{ check, request, ctaTemplate, event? }`. Default DOM event is `consentchange`.
- `index.js` — the `GCal` class. Composes the four primitives, adds no behavior of its own beyond glue. `mount()` is idempotent and returns an `unmount()`. `render()` always cancels any in-flight fetch via `AbortController` before starting a new one — `AbortError` is treated as success (intentional supersession), not surfaced to `onError`.

The `exports` map in `package.json` exposes each primitive as a subpath (`./dates`, `./fetch`, `./template`, `./consent`) so consumers can use them without instantiating `GCal`. Keep that map in sync when adding modules.

## Conventions

- **`@docs` pointers.** Every source file starts with `@docs ../docs/<name>.md`. The `docs/` directory doesn't exist yet — these are forward references for when long-form docs land. Per-symbol `@docs` tags go on non-trivial functions. Don't strip these.
- **Comment liberally.** Existing files document the *why* in prose above non-obvious code (cache rationale, Google's `end.date`-is-exclusive quirk, AbortError handling). Match that register when editing.
- **Zero dependencies, ESM only.** Don't add a dependency without a hard reason. Don't introduce a build step. `package.json` has `"sideEffects": false` and `"type": "module"` — preserve both.
- **`dist/gcal.css` is hand-maintained**, not generated. Tunable via `--gcal-*` custom properties documented in the README.
- **Browser support**: modern evergreens. `fetch`, `Intl.DateTimeFormat`, `<template>`, `URLSearchParams`, `AbortController` are all assumed.

## Workflow

Owner-of-record is `@copperdesign` (Christian). Per the global working-style, this is a personal repo — commits land on `master` directly, no PR ceremony. Default branch is `master`.
