import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessTokensService } from './access-tokens.service';
import { migrateImportedAccessTokens } from './access-token-migration';
import { localSecretStorage } from '../secrets/secret-storage';
import type { SecretStorage } from '../secrets/secret-storage';
import { EventsGateway } from '../events/events.gateway';
import { PullRequestsService } from '../repository/pull-requests.service';
import { RepositoryService } from '../repository/repository.service';
import type { PullRequestQuery, PullRequestRemote } from '@alune/shared';

describe('named access tokens and repository bindings', () => {
  let directory: string;
  let db: Database.Database;
  let storage: SecretStorage;
  let tokens: AccessTokensService;
  let requests: PullRequestsService;
  let remotes: jest.Mock;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  const target: PullRequestRemote = {
    name: 'origin',
    host: 'git.example.com:8443',
    project: 'team/repo',
    webUrl: 'https://git.example.com:8443/team/repo',
    provider: null,
  };
  const query: PullRequestQuery = {
    remote: target.name,
    target: target.webUrl,
    provider: 'gitlab',
    page: 1,
    state: 'open',
  };
  const events = { server: { emit: jest.fn() } } as unknown as EventsGateway;
  const revision = () => tokens.list().revision;
  const create = (name = 'Company', value = 'fixture-secret') =>
    tokens
      .save(null, { name, value, revision: revision() })
      .tokens.find((t) => t.name === name.trim())!;
  const apply = (id: string | null, remote = target, repositoryId = 'repo') =>
    tokens.apply(repositoryId, remote, {
      remote: remote.name,
      target: remote.webUrl,
      provider: 'gitlab',
      tokenId: id,
      revision: revision(),
    });
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'alune-tokens-'));
    db = new Database(join(directory, 'tokens.db'));
    db.pragma('foreign_keys = ON');
    db.exec(
      "CREATE TABLE repositories (id TEXT PRIMARY KEY, name TEXT); INSERT INTO repositories VALUES ('repo', 'Repository'), ('other', 'Other');",
    );
    storage = localSecretStorage(directory);
    tokens = new AccessTokensService(db, storage, events);
    remotes = jest
      .fn()
      .mockResolvedValue([
        { name: 'origin', fetchUrl: `${target.webUrl}.git`, pushUrl: '' },
      ]);
    requests = new PullRequestsService(
      { getRemotes: remotes } as unknown as RepositoryService,
      tokens,
    );
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('[]'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    db.close();
    rmSync(directory, { force: true, recursive: true });
  });

  it('validates names/values, masks reads and restores encrypted secrets and stable associations after restart', async () => {
    for (const input of [
      { name: '', value: 'secret' },
      { name: 'a'.repeat(51), value: 'secret' },
      { name: 'Company', value: '' },
      { name: 'Company', value: 'a\nb' },
    ])
      expect(() =>
        tokens.save(null, { ...input, revision: revision() }),
      ).toThrow();
    const token = create(' Company ');
    expect(token.name).toBe('Company');
    expect(() => create('company')).toThrow('名称已存在');
    const snapshot = apply(token.id);
    expect(snapshot.tokens[0]).toMatchObject({
      scope: { provider: 'gitlab', origin: 'https://git.example.com:8443' },
      associations: [{ repositoryId: 'repo', remote: 'origin' }],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /fixture-secret|ciphertext|aes-gcm/,
    );
    expect(
      readFileSync(join(directory, 'tokens.db')).includes(
        Buffer.from('fixture-secret'),
      ),
    ).toBe(false);
    db.close();
    db = new Database(join(directory, 'tokens.db'));
    db.pragma('foreign_keys = ON');
    tokens = new AccessTokensService(db, localSecretStorage(directory), events);
    requests = new PullRequestsService(
      { getRemotes: remotes } as unknown as RepositoryService,
      tokens,
    );
    expect((await requests.remotes('repo'))[0].selection).toMatchObject({
      tokenId: token.id,
      provider: 'gitlab',
      status: 'applied',
    });
    await requests.list('repo', query);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toHaveProperty(
      'PRIVATE-TOKEN',
      'fixture-secret',
    );
  });

  it('renames by stable ID, uses replacements immediately and does not use any global default', async () => {
    const token = create();
    apply(token.id);
    tokens.save(token.id, { name: 'Renamed', revision: revision() });
    expect(tokens.selection('repo', target).tokenId).toBe(token.id);
    tokens.save(token.id, {
      name: 'Renamed',
      value: 'replacement-value',
      revision: revision(),
    });
    await requests.list('repo', query);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toHaveProperty(
      'PRIVATE-TOKEN',
      'replacement-value',
    );
    await requests.list('other', query);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty(
      'PRIVATE-TOKEN',
    );
    await requests.list('repo', { ...query, token: 'temporary' });
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toHaveProperty(
      'PRIVATE-TOKEN',
      'temporary',
    );
    await requests.list('repo', query);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toHaveProperty(
      'PRIVATE-TOKEN',
      'replacement-value',
    );
    apply(null);
    await requests.list('repo', query);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty(
      'PRIVATE-TOKEN',
    );
    expect(tokens.list().tokens).toHaveLength(1);
  });

  it('rejects concurrent edits/deletion after impact changes, and removes every secret/reference on deletion', async () => {
    const token = create();
    apply(token.id);
    const beforeNewAssociation = revision();
    apply(token.id, target, 'other');
    expect(() =>
      tokens.delete(token.id, { revision: beforeNewAssociation }),
    ).toThrow('关联已变化');
    expect(() =>
      tokens.save(token.id, { name: 'Stale', revision: beforeNewAssociation }),
    ).toThrow('关联已变化');
    tokens.delete(token.id, { revision: revision() });
    expect(db.prepare('SELECT * FROM access_token_secrets').all()).toEqual([]);
    expect(
      db
        .prepare(
          'SELECT * FROM access_token_bindings WHERE token_id IS NOT NULL',
        )
        .all(),
    ).toEqual([]);
    expect(tokens.selection('repo', target).status).toBe('token-deleted');
    expect(tokens.selection('repo', target).provider).toBe('gitlab');
    await expect(requests.list('repo', query)).rejects.toThrow('原令牌已删除');
    expect(fetchMock).not.toHaveBeenCalled();
    await requests.list('repo', { ...query, token: '' });
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty(
      'PRIVATE-TOKEN',
    );
    apply(null);
    expect(tokens.selection('repo', target).status).toBe('applied');
  });

  it.each([
    'https://different.example.com/team/repo',
    'https://git.example.com:9443/team/repo',
    'https://git.example.com:8443/team/other',
  ])(
    'requires reconfirmation after destination changes to %s, including after reverting',
    async (changed) => {
      const token = create();
      apply(token.id);
      remotes.mockResolvedValue([
        { name: 'origin', fetchUrl: `${changed}.git`, pushUrl: '' },
      ]);
      await expect(
        requests.list('repo', { ...query, target: changed }),
      ).rejects.toThrow('目标或平台已变化');
      expect(fetchMock).not.toHaveBeenCalled();
      remotes.mockResolvedValue([
        { name: 'origin', fetchUrl: `${target.webUrl}.git`, pushUrl: '' },
      ]);
      await expect(requests.list('repo', query)).rejects.toThrow(
        '目标或平台已变化',
      );
      apply(token.id);
      await requests.list('repo', query);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('binds an unused token atomically, prevents cross-origin/provider reuse, and supports independent accounts and remotes', async () => {
    const token = create();
    const initial = revision();
    apply(token.id);
    expect(() =>
      tokens.apply(
        'other',
        { ...target, webUrl: 'https://other.example.com/team/repo' },
        { ...query, tokenId: token.id, revision: initial },
      ),
    ).toThrow('关联已变化');
    for (const [webUrl, provider] of [
      ['https://other.example.com/team/repo', 'gitlab'],
      ['https://git.example.com:9443/team/repo', 'gitlab'],
      [target.webUrl, 'github'],
    ] as const)
      expect(() =>
        tokens.apply(
          'other',
          { ...target, webUrl },
          { ...query, provider, tokenId: token.id, revision: revision() },
        ),
      ).toThrow('其他平台或主机');
    const second = create('Other account', 'other-value');
    apply(second.id, { ...target, name: 'upstream' });
    expect(tokens.credential('repo', target, 'gitlab').token).toBe(
      'fixture-secret',
    );
    expect(
      tokens.credential('repo', { ...target, name: 'upstream' }, 'gitlab')
        .token,
    ).toBe('other-value');
    await expect(
      requests.applyToken('repo', {
        ...query,
        target: 'https://forged.example.com/a/b',
        tokenId: second.id,
        revision: revision(),
      }),
    ).rejects.toThrow('远端地址已变化');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not let an old in-flight response overwrite a replaced/deleted token or a new association', async () => {
    const token = create();
    apply(token.id);
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = requests.list('repo', query);
    while (!resolve) await new Promise((done) => setImmediate(done));
    tokens.save(token.id, {
      name: token.name,
      value: 'new-value',
      revision: revision(),
    });
    resolve(new Response('[]'));
    await expect(pending).rejects.toThrow('关联已变化');
  });

  it('fails closed when encryption or decryption fails, supports metadata edits/deletion, and rolls back failed writes', async () => {
    const token = create();
    apply(token.id);
    storage.available = false;
    const before = tokens.list();
    expect(() => create('Unavailable')).toThrow('加密存储不可用');
    expect(tokens.list()).toEqual(before);
    await expect(requests.list('repo', query)).rejects.toThrow('无法解密');
    expect(fetchMock).not.toHaveBeenCalled();
    await requests.list('repo', { ...query, token: 'temporary' });
    tokens.save(token.id, { name: 'Metadata only', revision: revision() });
    storage.available = true;
    db.prepare('UPDATE access_token_secrets SET ciphertext = ?').run('damaged');
    await expect(requests.list('repo', query)).rejects.toThrow('无法解密');
    const rev = revision();
    db.exec(
      "CREATE TRIGGER fail_update BEFORE UPDATE ON access_tokens BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
    );
    expect(() =>
      tokens.save(token.id, { name: 'Not saved', revision: rev }),
    ).toThrow('保存失败');
    expect(revision()).toBe(rev);
    expect(tokens.list().tokens[0].name).toBe('Metadata only');
    tokens.delete(token.id, { revision: rev });
    expect(tokens.list().tokens).toEqual([]);
  });

  it.each([401, 403, 404, 429, 503])(
    'preserves the chosen credential after HTTP %s without echoing upstream content',
    async (status) => {
      const token = create();
      apply(token.id);
      fetchMock.mockResolvedValue(new Response('fixture-secret', { status }));
      await expect(requests.list('repo', query)).rejects.toMatchObject({
        message: expect.not.stringContaining('fixture-secret'),
      });
      expect(tokens.selection('repo', target)).toMatchObject({
        tokenId: token.id,
        status: 'applied',
      });
    },
  );

  it('cleans up associations when a repository is removed', () => {
    const token = create();
    apply(token.id);
    db.prepare('DELETE FROM repositories WHERE id = ?').run('repo');
    expect(tokens.list().tokens[0].associations).toEqual([]);
  });

  it('re-encrypts an imported standalone database atomically without losing IDs, scopes or associations', () => {
    const first = create();
    apply(first.id);
    const second = create('Other');
    const desktop = localSecretStorage(join(directory, 'desktop'));
    const before = db
      .prepare('SELECT * FROM access_token_secrets ORDER BY token_id')
      .all();
    desktop.available = false;
    expect(migrateImportedAccessTokens(db, storage, desktop)).toBe(false);
    expect(
      db.prepare('SELECT * FROM access_token_secrets ORDER BY token_id').all(),
    ).toEqual(before);
    desktop.available = true;
    const decrypt = jest.spyOn(storage, 'decrypt');
    decrypt
      .mockImplementationOnce(() => 'fixture-secret')
      .mockImplementationOnce(() => {
        throw new Error('damaged-secret');
      });
    expect(migrateImportedAccessTokens(db, storage, desktop)).toBe(false);
    expect(
      db.prepare('SELECT * FROM access_token_secrets ORDER BY token_id').all(),
    ).toEqual(before);
    decrypt.mockRestore();
    expect(migrateImportedAccessTokens(db, storage, desktop)).toBe(true);
    tokens = new AccessTokensService(db, desktop, events);
    expect(
      tokens
        .list()
        .tokens.map((t) => t.id)
        .sort(),
    ).toEqual([first.id, second.id].sort());
    expect(tokens.selection('repo', target).tokenId).toBe(first.id);
    expect(tokens.credential('repo', target, 'gitlab').token).toBe(
      'fixture-secret',
    );
  });
});
