/**
 * @docs ../README.md#outputs-gating-your-own-deploy
 *
 * The caller-facing contract of .github/workflows/sync.yml, checked
 * statically: the output wiring, and the one line that decides whether the
 * workflow can be called at all.
 *
 * WHY THIS EXISTS
 * A reusable workflow declares each output TWICE — once on `workflow_call`,
 * once on the job — and the caller reads the first, which is populated from
 * the second. Wire up only one of the two and nothing fails: no warning, no
 * red run, just `needs.sync.outputs.<x>` evaluating to an empty string. A
 * deploy gated on `changed` then never runs, and the calendar quietly stops
 * appearing. The same silence covers a renamed step output.
 *
 * There is no YAML parser here (the package has no dependencies and Node has
 * none built in), so this reads the file as text and matches on the shapes
 * that carry the contract. It is deliberately about NAMES, not layout —
 * reformatting the workflow shouldn't fail this, renaming half a wire should.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const yml = readFileSync(new URL('../.github/workflows/sync.yml', import.meta.url), 'utf8');

const all = (re) => [...yml.matchAll(re)].map((m) => m[1]);

/**
 * `echo "changed=true" >> "$GITHUB_OUTPUT"` — what the steps actually publish.
 * `.*` rather than `[^"]*`: several of these interpolate a command
 * substitution that carries quotes of its own.
 */
const published = new Set(all(/echo "([a-z-]+)=.*" >> "\$GITHUB_OUTPUT"/g));

/** `${{ steps.commit.outputs.changed }}` — what the job claims to read back. */
const readFromStep = new Set(all(/steps\.commit\.outputs\.([a-z-]+)/g));

/** `${{ jobs.sync.outputs.changed }}` — what `workflow_call` hands the caller. */
const readFromJob = new Set(all(/jobs\.sync\.outputs\.([a-z-]+)/g));

/** Keys in the job's own `outputs:` map, i.e. `changed: ${{ steps.… }}`. */
const jobOutputs = new Set(all(/^\s+([a-z-]+):\s+\$\{\{ steps\./gm));

test('every step output the job reads is one a step writes', () => {
  for (const name of readFromStep) {
    assert.ok(
      published.has(name),
      `steps.commit.outputs.${name} is read but never written — it will evaluate to ''`,
    );
  }
});

test('every output the caller is promised is wired through the job', () => {
  // The both-levels trap. `workflow_call.outputs.x` sourced from
  // `jobs.sync.outputs.x` is worth nothing if the job never declares x.
  for (const name of readFromJob) {
    assert.ok(
      jobOutputs.has(name),
      `workflow_call promises ${name}, but the job has no such output`,
    );
  }
});

test('the caller-facing contract still carries all four outputs', () => {
  // Named explicitly rather than derived, so deleting one is a decision
  // someone has to make here as well as there. Consumers pin a tag and
  // read these by name.
  for (const name of ['changed', 'events', 'out', 'artifact']) {
    assert.ok(readFromJob.has(name), `workflow_call no longer exposes ${name}`);
  }
});

test('the upload is gated on the same output that names it', () => {
  // Under commit: false the artifact name is decided in the commit step and
  // consumed twice: once to decide whether to upload at all, once as the
  // name the caller downloads by. If those drift, the upload happens under
  // a name nobody was handed — and the caller's download fails in a job the
  // sync has already reported green.
  assert.match(yml, /if: steps\.commit\.outputs\.artifact != ''/);
  assert.match(yml, /name: \$\{\{ steps\.commit\.outputs\.artifact \}\}/);
  assert.match(yml, /path: \$\{\{ steps\.commit\.outputs\.out \}\}/);
});

test('the workflow declares no permissions of its own', () => {
  // Not a style rule — this is the bug that made the workflow uncallable
  // from 0.2.0 to 0.5.0, and nothing about it is visible from in here.
  //
  // A called workflow inherits the token of the job that called it and
  // cannot ask for more. `permissions: contents: write` in this file is
  // therefore a ceiling check, not a request, and it fails the caller's
  // whole run as a startup_failure — no job, no step, no log — for every
  // repository whose default workflow token is read. That has been the
  // default since February 2023, so it was the out-of-the-box experience
  // for everyone. The grant belongs on the calling job; the README says so.
  //
  // `permissions` takes no expressions either, so a fixed block would also
  // force `commit: false` callers to hand a write token to a job that only
  // fetches. Two reasons, one rule: don't put it back.
  assert.doesNotMatch(
    yml,
    /^\s*permissions:/m,
    'sync.yml must not declare permissions — it makes the workflow uncallable from a read-token repo',
  );
});

test('commit defaults to true — adopting the input must not change behaviour', () => {
  // A consumer on an older tag upgrades and gets the same job it had.
  assert.match(yml, /commit:\n\s+description:[^\n]*\n\s+type: boolean\n\s+default: true/);
});
