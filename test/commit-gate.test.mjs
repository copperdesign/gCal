/**
 * @docs ../README.md#nightly-sync-with-github-actions
 *
 * The change-detection logic from .github/workflows/sync.yml, exercised
 * against a real git repository.
 *
 * WHY THIS EXISTS
 * The first version of that step used `git diff --quiet -- "$out"`, which is
 * the obvious way to ask "did this file change" and is wrong for the one case
 * that matters most: `git diff` compares the working tree against the index and
 * cannot see an UNTRACKED file. On a consumer's very first sync the artifact is
 * brand new, so the check reported "unchanged", the job exited 0, and the file
 * was never committed. Every subsequent run wrote it and discarded it again.
 *
 * That failure is invisible from the outside — a green job, a clean summary,
 * "Calendar unchanged" in a log nobody reads, and a calendar that simply never
 * appears. It shipped in v0.2.0 and was caught only by watching a real first
 * run against a real calendar.
 *
 * Shell can't be imported, so the commands are replicated here verbatim. If the
 * workflow's logic changes, change it in both places — the duplication is the
 * price of testing a YAML `run:` block at all, and cheaper than shipping this
 * bug twice.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'src/content/kalender.json';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'gcal-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString();
  git('init', '-q', '.');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'src', 'content'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'seed\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  return { dir, git, write: (s) => writeFileSync(join(dir, OUT), s) };
}

/** The workflow's gate: stage, then ask whether anything is staged. */
function gate(r) {
  r.git('add', '--', OUT);
  try {
    execFileSync('git', ['diff', '--cached', '--quiet', '--', OUT], { cwd: r.dir, stdio: 'pipe' });
    return false;
  } catch {
    return true;
  }
}

/** The ORIGINAL, broken gate — kept so the regression stays legible. */
function brokenGate(r) {
  try {
    execFileSync('git', ['diff', '--quiet', '--', OUT], { cwd: r.dir, stdio: 'pipe' });
    return false;
  } catch {
    return true;
  }
}

test('a brand-new artifact is committed on the first run', () => {
  const r = repo();
  try {
    r.write('{"schemaVersion":1,"events":[]}\n');
    assert.equal(gate(r), true, 'first run must commit — this is the v0.2.0 bug');
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('the original `git diff --quiet` gate demonstrably missed that case', () => {
  // Not a hypothetical. Locking in the reason the fix exists, so nobody
  // "simplifies" it back.
  const r = repo();
  try {
    r.write('{"schemaVersion":1,"events":[]}\n');
    assert.equal(brokenGate(r), false, 'git diff should be blind to an untracked file');
    assert.equal(gate(r), true, 'the fixed gate must see it');
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a changed artifact is committed', () => {
  const r = repo();
  try {
    r.write('{"schemaVersion":1,"events":[]}\n');
    r.git('add', '-A');
    r.git('commit', '-qm', 'seed artifact');
    r.write('{"schemaVersion":1,"events":[{"id":"a"}]}\n');
    assert.equal(gate(r), true);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('an unchanged artifact is NOT committed — the quiet-night case', () => {
  // The other half of the contract: a no-op night must not create a commit, or
  // consumers get 365 empty commits a year and a deploy on every one.
  const r = repo();
  try {
    r.write('{"schemaVersion":1,"events":[]}\n');
    r.git('add', '-A');
    r.git('commit', '-qm', 'seed artifact');
    r.write('{"schemaVersion":1,"events":[]}\n'); // rewritten, identical bytes
    assert.equal(gate(r), false);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('the gate stages only the artifact, never unrelated files', () => {
  // The job holds contents:write. `git add -A` here would sweep up anything
  // else on the runner into a bot commit.
  const r = repo();
  try {
    r.write('{"schemaVersion":1,"events":[]}\n');
    writeFileSync(join(r.dir, 'unrelated.txt'), 'do not commit me\n');
    gate(r);
    const staged = r.git('diff', '--cached', '--name-only').trim().split('\n').filter(Boolean);
    assert.deepEqual(staged, [OUT]);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});
