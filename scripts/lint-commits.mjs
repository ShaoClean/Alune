import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function lintEvent(eventName, event, directory = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  const lint = (args, input) => execFileSync(process.execPath, [
    fileURLToPath(import.meta.resolve('@commitlint/cli/cli.js')),
    '--config', path.join(root, 'commitlint.config.cjs'), '--verbose', ...args,
  ], { cwd: directory, encoding: 'utf8', input, stdio: ['pipe', 'inherit', 'inherit'] });
  const ensureCommit = (sha) => {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new Error('Missing or invalid event commit SHA');
    const result = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: directory });
    if (result.error) throw result.error;
    // A force push can remove the old tip from the normal checkout history.
    if (result.status !== 0) git('fetch', '--no-tags', 'origin', sha);
    return sha;
  };

  let from;
  let to;
  if (eventName === 'pull_request') {
    lint([], `${event.pull_request.title}\n`);
    from = ensureCommit(event.pull_request.base.sha);
    to = ensureCommit(event.pull_request.head.sha);
  } else if (eventName === 'push') {
    if (event.deleted) return;
    to = ensureCommit(event.after);
    if (/^0+$/.test(event.before)) {
      const defaultBranch = event.repository.default_branch;
      if (event.ref !== `refs/heads/${defaultBranch}`) {
        from = git('merge-base', to, `refs/remotes/origin/${defaultBranch}`);
      }
    } else {
      from = ensureCommit(event.before);
    }
  } else {
    throw new Error(`Unsupported commitlint event: ${eventName}`);
  }
  // Existing history is excluded by the event boundary. Only a repository's
  // initial default-branch push needs to check its entire history.
  lint([...(from ? ['--from', from] : []), '--to', to]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    lintEvent(process.env.GITHUB_EVENT_NAME, event);
  } catch (error) {
    console.error(`[commitlint] ${error.message}`);
    process.exitCode = 1;
  }
}
