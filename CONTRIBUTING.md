# Contributing

Thanks for the interest. This is a small, focused browser library — the
modern successor to a pattern I've been shipping in client projects for
years. Contributions that make it sharper, less surprising, or more useful
to the next person dropping a Google Calendar into a hero or events list
are welcome.

## Ownership and merging

I (@copperdesign) maintain the repo and merge all PRs. You're welcome to
fork, branch, and propose changes — I'll review on my own timeline. No CLA.

## What fits

Yes:

- Bug fixes with a clear repro (a minimal HTML page that reproduces the
  glitch — Gist or CodePen — is the gold standard)
- Calendar-shape edge cases hit on real Google calendars: recurring
  events, cancelled exceptions, all-day vs. timed boundary quirks,
  weird timezone shapes
- Locale / `Intl` polish — connector words, formatting quirks for
  non-`de-DE` / non-`en-US` locales, date-range edge cases
- Sharper template binding heuristics — places where `data-slot`,
  `data-html`, `data-attr`, `data-remove-empty` interact in ways the
  current code mishandles
- Doc clarifications — especially the WHY of a behavior that confused
  you (Google's exclusive `end.date`, AbortError-as-success, the
  per-`(locale, timeZone)` `Intl.DateTimeFormat` cache)
- Quality-of-life additions to existing options that don't widen the
  API surface

Probably no — open an issue first to discuss:

- New top-level options on the `GCal` constructor
- New `data-*` binding attributes on the template contract
- Adding runtime dependencies (the module is intentionally zero-deps;
  the contract is `src/*.js` + browser APIs only)
- Restructuring `src/` into a different shape — the four primitives
  + facade layout, and the `exports` subpaths that mirror it, are
  part of the contract
- Framework-specific wrappers (React, Vue, etc.) — these belong in
  separate packages that depend on this one
- Bundling a specific consent SDK — the consent contract is provider-
  agnostic on purpose

Hard no:

- Adding a build step, bundler, or transpile pipeline. The module
  ships as plain ES module source.
- Telemetry, analytics, "phone home" of any kind.
- Auto-generated boilerplate PRs (license bumps from bots, dependency
  pings against non-existent deps, mass formatting reflows).
- Polyfills for `fetch` / `Intl` / `<template>` / `URLSearchParams` /
  `AbortController` — modern evergreens are the floor we target.

## Getting set up

```bash
git clone https://github.com/copperdesign/gCal.git
cd gCal
```

No `npm install` — there are no dependencies, runtime or dev. Open the
relevant HTML page directly in a browser to exercise the module:

```bash
# any static server will do — pick your favorite
python3 -m http.server 8000
# then visit:
#   http://localhost:8000/test/   — inline smoke tests, offline
#   http://localhost:8000/demo/   — live demo against a real calendar
```

(File-protocol won't work — ES modules require `http(s)://`.)

The `demo/` page is the only path that hits the live Google Calendar
API. You'll need to paste in a public `calendarId` and an `apiKey`
locally. `test/` is fully offline.

## PR workflow

1. Fork and branch off `master`. Branch names are free-form.
2. Keep PRs scoped. One concern per PR; bundle small drive-by cleanups
   into the same diff if they're in the file you're touching, otherwise
   open a separate PR.
3. Write commit messages that explain *why*, not what. Mirror the style
   already in `git log` — short prefix, present-tense subject, body
   when it earns its place.
4. In the PR description: what changed, why, and how you tested. A
   short screen recording for anything visible (rendered events,
   consent CTA flow, locale formatting) saves a lot of back-and-forth.
5. Open the PR against `master`.

## Code style

The module is plain ES modules targeting evergreen browsers (anything
that ships native `fetch`, `Intl.DateTimeFormat`, `<template>`,
`URLSearchParams`, `AbortController`). No transpile, no bundle.

- **Zero runtime deps.** Browser APIs only. If you need a helper, write
  it inline.
- **Four primitives + one facade.** `fetch.js`, `dates.js`,
  `template.js`, `consent.js` are independently importable via the
  `exports` subpaths; `index.js` is glue. Don't fold primitives into
  the facade, and don't introduce new top-level modules without
  updating the `exports` map.
- **`@docs` pointers.** Source files start with `@docs ../docs/<name>.md`,
  and non-trivial functions get their own `@docs` tag. The `docs/`
  directory doesn't exist yet — these are forward references for when
  long-form docs land. Don't strip them.
- **Comment liberally.** Inline comments explain WHY. Browser quirks,
  Google API shapes, `Intl` gotchas, the reason `AbortError` is treated
  as success — write the reasoning down. Don't narrate the obvious
  line below.
- **Long, descriptive names** over short clever ones.
- **`async`/`await` over callbacks or stray `.then()` chains.**
- **Idempotent lifecycle.** `mount()` returns an `unmount()`; calling
  `unmount()` twice should be safe and silent. Any in-flight fetch
  must be aborted on re-render or unmount.
- **Preserve `"sideEffects": false` and `"type": "module"`** in
  `package.json` — both are load-bearing for bundler tree-shaking and
  ESM resolution.

## Testing

There's no test runner — the module is exercised against `test/index.html`
(offline, inline `check()` helper) and `demo/index.html` (live API).
Before opening a PR:

1. Open `test/index.html` in a fresh browser. All rows green.
2. If you touched anything that hits the network or the consent flow,
   open `demo/index.html` and confirm the live path still renders.
3. Spot-check in at least one non-Chromium browser (Safari or Firefox).
   Safari is the strictest about `Intl` edge cases.

Note what you tested in the PR description, including browser + OS.

If you add a new behavior, extend `test/index.html` with another
numbered block using the existing `check(label, condition, detail)`
helper. Keep the offline-by-default property — only `demo/` should
hit the network.

## Reporting bugs

Open an issue with:

- A minimal HTML page that reproduces it (a Gist or CodePen is fine)
- The browser + OS where it reproduces
- What you expected vs. what happened
- The version (from `package.json` or your `npm ls` output)
- If relevant, a redacted snippet of the Google Calendar event JSON
  that triggers it (the `summary` / `start` / `end` shape is usually
  enough; strip anything personal)

## Asking questions

Issues are fine for questions too — tag them `question`. Don't email me
directly with usage questions; an issue helps the next person.
