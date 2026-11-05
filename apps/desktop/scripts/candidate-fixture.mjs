import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import Database from 'better-sqlite3';

export function legacyFixture(directory, { existing = false } = {}) {
  const repo = path.join(directory, 'candidate Git 仓库');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args]);
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Fixture');
  git('remote', 'add', 'origin', path.join(directory, 'fixture-remote.git'));
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(repo, 'candidate.txt'), 'original\n');
  writeFileSync(path.join(repo, 'unstaged.txt'), 'keep the index separate\n');
  git('add', 'candidate.txt', 'unstaged.txt');
  git('-c', 'commit.gpgSign=false', 'commit', '-qm', 'candidate fixture');
  writeFileSync(path.join(repo, 'candidate.txt'), 'changed in legacy workspace\n');
  writeFileSync(path.join(repo, 'unstaged.txt'), 'keep the working tree separate\n');
  const id = randomUUID(),
    db = new Database(path.join(directory, 'alune.db'));
  try {
    if (!existing)
      db.exec(
        'CREATE TABLE repositories (id TEXT PRIMARY KEY, connection_id TEXT,source TEXT,name TEXT,path TEXT,pinned INTEGER,created_at TEXT,worktree_kind TEXT)',
      );
    db.prepare(
      "INSERT INTO repositories (id,connection_id,source,name,path,pinned,created_at,worktree_kind) VALUES (?,NULL,'local',?,?,1,?,'main')",
    ).run(id, path.basename(repo), repo, new Date().toISOString());
  } finally {
    db.close();
  }
  const prior = existing
    ? JSON.parse(readFileSync(path.join(directory, 'workspace.json'), 'utf8')).state
    : {};
  writeFileSync(
    path.join(directory, 'workspace.json'),
    JSON.stringify({
      version: 1,
      state: {
        ...prior,
        repositorySession: { ids: [...(prior.repositorySession?.ids ?? []), id], activeId: id },
        appearance: prior.appearance ?? { theme: 'dark' },
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
    fromRelease: existing,
    db: hash('alune.db'),
    workspace: hash('workspace.json'),
  };
}
