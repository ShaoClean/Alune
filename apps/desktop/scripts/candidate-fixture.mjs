import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadIdentity } from '../../../packages/agent/dist/adapters/identity.js';
import { AgentState } from '../../../packages/agent/dist/adapters/sqlite/state.js';
import { RepositoryCatalog } from '../../../packages/agent/dist/modules/repositories/catalog.js';

export async function workspaceFixture(directory, { tray = false } = {}) {
  const repo = path.join(directory, 'candidate Git 仓库');
  mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(directory, 'empty.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env });
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Fixture');
  execFileSync('git', ['init', '--bare', '-q', path.join(directory, 'fixture-remote.git')], {
    env,
  });
  git('remote', 'add', 'origin', path.join(directory, 'fixture-remote.git'));
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(repo, 'candidate.txt'), 'original\n');
  writeFileSync(path.join(repo, 'unstaged.txt'), 'keep the index separate\n');
  writeFileSync(
    path.join(repo, 'README.md'),
    '# Candidate fixture\n\n[fixture source](example.ts)\n',
  );
  writeFileSync(path.join(repo, 'example.ts'), 'export const answer = 42;\n');
  git('add', 'README.md', 'example.ts', 'candidate.txt', 'unstaged.txt');
  git('-c', 'commit.gpgSign=false', 'commit', '-qm', 'candidate fixture');
  git('tag', 'ui-baseline');
  git('push', '-qu', 'origin', 'main', '--tags');
  writeFileSync(path.join(repo, 'candidate.txt'), 'changed in the workspace\n');
  writeFileSync(path.join(repo, 'unstaged.txt'), 'keep the working tree separate\n');
  const agentDirectory = path.join(directory, 'agent');
  const agentId = await loadIdentity(agentDirectory);
  const state = await AgentState.open(agentDirectory, agentId);
  try {
    const catalog = new RepositoryCatalog(state.database, agentId);
    const { id, resource } = catalog.register(repo, path.basename(repo), 'main');
    let linkedId;
    if (tray) {
      const parent = path.join(directory, 'second');
      mkdirSync(parent);
      const linked = path.join(parent, path.basename(repo));
      git('worktree', 'add', '-qb', 'tray-linked', linked);
      linkedId = catalog.register(linked, path.basename(linked), 'linked').id;
    }
    catalog.pin(resource, true);
    writeFileSync(
      path.join(agentDirectory, 'workspace.json'),
      JSON.stringify({
        version: 1,
        state: {
          repositorySession: { ids: linkedId ? [id, linkedId] : [id], activeId: id },
          appearance: { theme: 'dark' },
        },
      }),
    );
    return { repo, id, linkedId };
  } finally {
    await state.close();
  }
}
