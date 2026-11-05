import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import Database from 'better-sqlite3';

export function legacyFixture(directory) {
  const repo = path.join(directory, 'candidate Git 仓库');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args]);
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(repo, 'candidate.txt'), 'original\n');
  git('add', 'candidate.txt');
  git('-c', 'commit.gpgSign=false', 'commit', '-qm', 'candidate fixture');
  writeFileSync(path.join(repo, 'candidate.txt'), 'changed in legacy workspace\n');
  const id = randomUUID(),
    db = new Database(path.join(directory, 'alune.db'));
  try {
    db.exec(
      'CREATE TABLE repositories (id TEXT PRIMARY KEY, connection_id TEXT,source TEXT,name TEXT,path TEXT,pinned INTEGER,created_at TEXT,worktree_kind TEXT)',
    );
    db.prepare("INSERT INTO repositories VALUES (?,NULL,'local',?,?,1,?,'main')").run(
      id,
      path.basename(repo),
      repo,
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
  writeFileSync(
    path.join(directory, 'workspace.json'),
    JSON.stringify({
      version: 1,
      state: { repositorySession: { ids: [id], activeId: id }, appearance: { theme: 'dark' } },
    }),
  );
  const hash = (file) =>
    createHash('sha256')
      .update(readFileSync(path.join(directory, file)))
      .digest('hex');
  return { repo, id, db: hash('alune.db'), workspace: hash('workspace.json') };
}
