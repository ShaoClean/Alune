import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import Database from 'better-sqlite3';

export function legacyFixture(directory) {
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
  writeFileSync(path.join(repo, 'candidate.txt'), 'changed in legacy workspace\n');
  writeFileSync(path.join(repo, 'unstaged.txt'), 'keep the working tree separate\n');
  const id = randomUUID(),
    db = new Database(path.join(directory, 'alune.db'));
  try {
    db.exec(
      'CREATE TABLE repositories (id TEXT PRIMARY KEY, connection_id TEXT,source TEXT,name TEXT,path TEXT,pinned INTEGER,created_at TEXT,worktree_kind TEXT)',
    );
    db.prepare(
      "INSERT INTO repositories (id,connection_id,source,name,path,pinned,created_at,worktree_kind) VALUES (?,NULL,'local',?,?,1,?,'main')",
    ).run(id, path.basename(repo), repo, new Date().toISOString());
  } finally {
    db.close();
  }
  writeFileSync(
    path.join(directory, 'workspace.json'),
    JSON.stringify({
      version: 1,
      state: {
        repositorySession: { ids: [id], activeId: id },
        appearance: { theme: 'dark' },
      },
    }),
  );
  const hash = (file) =>
    createHash('sha256')
      .update(readFileSync(path.join(directory, file)))
      .digest('hex');
  return {
    repo,
    id,
    fromRelease: false,
    db: hash('alune.db'),
    workspace: hash('workspace.json'),
  };
}
