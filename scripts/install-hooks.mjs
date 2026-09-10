import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(path.join(root, '.git'))) {
  console.log('[hooks] Skipping installation outside a Git checkout.');
  process.exit(0);
}

const config = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
if (config.error) throw config.error;
if (config.status !== 0 && config.status !== 1) throw new Error(config.stderr || 'Cannot read Git hook configuration');
const current = config.stdout.trim();
if (current && current !== '.githooks') {
  console.warn(`[hooks] Keeping existing core.hooksPath (${current}). Add "node scripts/pre-push.mjs" to its pre-push hook, forwarding Git stdin.`);
  process.exit(0);
}

if (!current) {
  const hooks = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' }).trim();
  const hooksDirectory = path.resolve(root, hooks);
  const existing = existsSync(hooksDirectory) && readdirSync(hooksDirectory).some((name) => !name.endsWith('.sample') && !name.startsWith('.'));
  if (existing) {
    console.warn('[hooks] Keeping existing Git hooks. Add "node scripts/pre-push.mjs" to the pre-push hook, forwarding Git stdin.');
    process.exit(0);
  }
}

chmodSync(path.join(root, '.githooks/pre-push'), 0o755);
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'inherit' });
console.log('[hooks] Installed pre-push version checks.');
