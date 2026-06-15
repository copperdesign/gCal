---
name: Bug report
about: Something broke or behaved unexpectedly
title: ''
labels: bug
assignees: ''
---

## What happened

<!-- One paragraph. What you set up, what you saw, what you expected. -->

## Repro

<!-- A minimal HTML page that reproduces it. A Gist or CodePen link is
     fine. The smaller the repro, the faster the fix. -->

```html
<div id="events"></div>

<template id="gcal-row">
  <article>
    <header data-slot="dates"></header>
    <h3 data-slot="summary"></h3>
  </article>
</template>

<script type="module">
  import { GCal } from '@copperdesign/gcal';

  new GCal({
    target:     '#events',
    template:   '#gcal-row',
    calendarId: '...',
    apiKey:     '...',
  }).mount();
</script>
```

<!-- If the bug is in formatting / locale handling, a redacted snippet
     of the offending event JSON (just `start`, `end`, `summary`) is
     usually enough — strip anything personal. -->

## Environment

- Package version (from `package.json` or `npm ls @copperdesign/gcal`):
- Browser + version:
- OS (+ mobile/desktop):
- Locale / timeZone (if relevant to the bug):

## Screen recording (optional)

<!-- For anything visual — rendered events, consent CTA flow, locale
     formatting — a short clip is worth a thousand words. -->
