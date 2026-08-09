/**
 * @docs ../README.md
 *
 * What actually ends up in the published tarball.
 *
 * The CI metadata checks run one direction only: every entry in
 * `files` / `exports` / `bin` must EXIST on disk. Nothing asserts the
 * reverse — that everything we advertise is actually shipped — and that
 * gap is real: an `exports` subpath pointing outside the `files`
 * allowlist resolves fine locally, passes every existing check, and is
 * simply absent from the tarball. Consumers get a module-not-found on
 * install.
 *
 * WHAT THIS DOES NOT GUARD, contrary to what you might assume:
 * dropping `bin` from `files` does NOT break the published CLI. npm
 * always includes files referenced by `bin` (along with package.json,
 * README, LICENSE and `main`) no matter what the allowlist says —
 * verified by packing with `bin` removed and finding it in the tarball
 * anyway. `bin` is listed in `files` for readability, not because
 * anything depends on it. The assertion below is kept as a cheap
 * tripwire, but the load-bearing test here is the `exports` sweep.
 *
 * Slow by this package's standards — it shells out to npm — and worth
 * it for the one failure mode that is otherwise invisible until a
 * consumer installs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

// `npm pack --dry-run` computes the tarball contents without writing one.
const packed = await (async () => {
  const { stdout } = await run('npm', ['pack', '--dry-run', '--json'], { cwd: root });
  return new Set(JSON.parse(stdout)[0].files.map((f) => f.path));
})();

const strip = (p) => p.replace(/^\.\//, '');

test('every exports subpath ships in the tarball', () => {
  // The one that earns its keep. An exports target outside the `files`
  // allowlist resolves locally and vanishes on publish.
  const targets = Object.values(pkg.exports).map((v) => (typeof v === 'string' ? v : v.import ?? v.default));
  for (const target of targets) {
    assert.ok(
      packed.has(strip(target)),
      `${target} is in the exports map but missing from the tarball — add its directory to "files"`,
    );
  }
});

test('every bin entry ships in the tarball', () => {
  // npm ships bin targets regardless of `files`, so this can realistically
  // only fail if a bin path is renamed without updating package.json.
  const bins = Object.values(pkg.bin ?? {});
  assert.ok(bins.length > 0, 'expected at least one bin entry');
  for (const bin of bins) {
    assert.ok(packed.has(strip(bin)), `${bin} is declared in "bin" but missing from the tarball`);
  }
});

test('the SSG entry point ships', () => {
  // Named explicitly rather than relying on the exports sweep above: a
  // consumer's whole build depends on this one file being present.
  assert.ok(packed.has('src/node.js'));
  assert.ok(packed.has('bin/gcal-sync.mjs'));
});

test('test fixtures and the test suite stay out of the tarball', () => {
  for (const path of packed) {
    assert.ok(!path.startsWith('test/'), `${path} should not be published`);
  }
});
