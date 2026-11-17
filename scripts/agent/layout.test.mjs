import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));

function readSource(filename) {
  try {
    return fs.readFileSync(path.join(root, filename), 'utf8');
  } catch (error) {
    // Standalone Agent CI checks out only two desktop source files.
    // Read excluded callers from Git, while rejecting accidental deletes.
    const entry = execFileSync('git', ['ls-files', '-t', '--', filename], {
      cwd: root,
      encoding: 'utf8',
    });
    if (error.code !== 'ENOENT' || !entry.startsWith('S ')) throw error;
    return execFileSync('git', ['show', 'HEAD:' + filename], {
      cwd: root,
      encoding: 'utf8',
    });
  }
}

test('CI and desktop packaging continue to invoke existing daily tools', () => {
  for (const filename of [
    '.github/workflows/agent-tests.yml',
    '.github/workflows/desktop-smoke.yml',
    '.github/workflows/release.yml',
    'apps/desktop/scripts/stage-agent.mjs',
    'package.json',
  ]) {
    const source = readSource(filename);
    for (const [file] of source.matchAll(/scripts\/agent\/[\w.-]+\.(?:mjs|cjs|json|sh)/g))
      assert(fs.existsSync(path.join(root, file)), filename + ': ' + file);
  }
});
