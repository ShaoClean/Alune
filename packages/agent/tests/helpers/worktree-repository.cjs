const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRepository } = require('./local-repository.cjs');

function createWorktreeRepository() {
  const fixture = createRepository();
  fixture.git('branch', '-m', 'main');
  const feature = path.join(fixture.root, "feature 中文 '$() worktree");
  const detached = path.join(fixture.root, 'detached-worktree');
  const missing = path.join(fixture.root, 'missing-worktree');
  fixture.git('worktree', 'add', '-qb', 'feature/worktrees', feature);
  fixture.git('worktree', 'add', '-q', '--detach', detached);
  fixture.git('worktree', 'add', '-qb', 'missing', missing);
  fs.rmSync(missing, { recursive: true, force: true });
  const runAt = (directory, ...args) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
  for (const [directory, marker] of [
    [fixture.repo, 'main'],
    [feature, 'feature'],
    [detached, 'detached'],
  ]) {
    fs.writeFileSync(path.join(directory, 'tracked.txt'), marker + ' staged\n');
    runAt(directory, 'add', 'tracked.txt');
    fs.appendFileSync(path.join(directory, 'tracked.txt'), marker + ' unstaged\n');
    fs.writeFileSync(path.join(directory, marker + '-new.txt'), marker + ' untracked\n');
  }
  return { ...fixture, feature, detached, missing, runAt };
}
module.exports = { createWorktreeRepository };
