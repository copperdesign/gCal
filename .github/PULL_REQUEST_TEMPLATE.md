<!--
Thanks for the PR. A few prompts to make review faster — delete anything
that doesn't apply.
-->

## What

<!-- One or two sentences. What this PR changes. -->

## Why

<!-- The motivating problem. A real calendar that broke, a Google API
     quirk you hit, a locale edge case the README missed, a consent
     flow that didn't compose with your stack. Skip the WHAT (the diff
     shows it); the WHY is what I'm reading for. -->

## How tested

<!-- Which browser(s) + OS you exercised it in. Safari is the strictest
     about Intl edge cases; mention it if you tested there. A short
     screen recording for anything visible (rendered events, CTA flow,
     formatting) saves a lot of back-and-forth. -->

- [ ] `test/index.html` opens with all rows green
- [ ] If the change touches the network or consent path: confirmed
      against `demo/index.html` with a real calendar
- [ ] Spot-checked in at least one non-Chromium browser (Safari or Firefox)
- [ ] If `mount()` / `unmount()` / `AbortController` code touched:
      confirmed `unmount()` actually stops re-renders and aborts
      in-flight fetches

## Notes for reviewer

<!-- Anything subtle: a heuristic you chose between, an API quirk you
     worked around, a follow-up you considered but punted. Optional. -->
