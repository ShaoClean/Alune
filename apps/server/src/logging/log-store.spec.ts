import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogStore, LogValidationError } from './log-store';
import { redactContext, redactText, registerSecret } from './redact';

describe('redaction', () => {
  it('masks credentials in text', () => {
    const text = redactText(
      [
        'push https://alice:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/a/b.git',
        'Authorization: Bearer abcdefghijklmnop',
        'PRIVATE-TOKEN: glpat-abcdefghijklmnopqrst',
        'url?access_token=secret123&page=2',
        'password=hunter22 next',
        'error token=abcdef123456 api_key: zzzz9999',
        'sk-ant-abcdefghijklmnopqrstuvwxyz',
        '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----',
      ].join('\n'),
    );
    for (const secret of [
      'alice',
      'ghp_abcdefghijklmnopqrstuvwxyz0123',
      'abcdefghijklmnop',
      'glpat-abcdefghijklmnopqrst',
      'secret123',
      'hunter22',
      'abcdef123456',
      'zzzz9999',
      'sk-ant-abcdefghijklmnopqrstuvwxyz',
      'AAAA',
    ])
      expect(text).not.toContain(secret);
    expect(text).toContain('https://***@github.com/a/b.git');
    expect(text).toContain('page=2');
  });

  it('masks sensitive keys, registered secrets and nested errors', () => {
    registerSecret('per-launch-token-value');
    const value = redactContext({
      password: 'p',
      apiKey: 'k',
      nested: { privateKey: 'x', note: 'auth per-launch-token-value' },
      error: new Error('Bearer abcdefghijklmnop failed'),
      ok: 'kept',
    })!;
    expect(value.password).toBe('[REDACTED]');
    expect(value.apiKey).toBe('[REDACTED]');
    expect((value.nested as any).privateKey).toBe('[REDACTED]');
    expect((value.nested as any).note).toBe('auth [REDACTED]');
    expect((value.error as any).message).not.toContain('abcdefghijklmnop');
    expect(value.ok).toBe('kept');
  });
});

describe('LogStore', () => {
  let dir: string;
  let now: Date;
  let store: LogStore | undefined;
  const create = () => (store = new LogStore(dir, () => new Date(now)));
  const files = (path = join(dir, 'logs')) =>
    readdirSync(path)
      .filter((name) => name.endsWith('.log'))
      .sort();
  const lines = (name: string, path = join(dir, 'logs')) =>
    readFileSync(join(path, name), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'alune-logs-'));
    now = new Date(2026, 9, 14, 10, 0, 0);
  });
  afterEach(() => {
    store?.close();
    store = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes redacted JSON lines filtered by level', () => {
    const logs = create();
    logs.write('DEBUG', 'git', 'hidden');
    logs.write('INFO', 'git', 'commit done', { token: 'abc', durationMs: 5 });
    logs.flush();
    const [entry] = lines('alune-2026-10-14.log');
    expect(entry).toMatchObject({
      level: 'INFO',
      source: 'git',
      message: 'commit done',
      context: { token: '[REDACTED]', durationMs: 5 },
    });
    expect(lines('alune-2026-10-14.log')).toHaveLength(1);
  });

  it('persists settings, applies the level at once and validates input', () => {
    const logs = create();
    logs.update({
      customDirectory: null,
      level: 'DEBUG',
      retentionDays: 3,
      maxTotalMB: 50,
    });
    logs.write('DEBUG', 'git', 'visible');
    expect(logs.recent().at(-1)?.message).toBe('visible');
    logs.close();
    expect(create().settings()).toMatchObject({
      level: 'DEBUG',
      retentionDays: 3,
    });
    expect(() =>
      store!.update({ level: 'TRACE', retentionDays: 3, maxTotalMB: 50 }),
    ).toThrow(LogValidationError);
    expect(() =>
      store!.update({
        customDirectory: 'relative',
        level: 'INFO',
        retentionDays: 3,
        maxTotalMB: 50,
      }),
    ).toThrow('绝对路径');
  });

  it('rolls over by day and size and removes old files', () => {
    const logs = create();
    logs.write('INFO', 'a', 'x'.repeat(1024));
    logs.flush();
    now = new Date(2026, 9, 15, 0, 1);
    logs.write('INFO', 'a', 'next day');
    logs.flush();
    expect(files()).toEqual(['alune-2026-10-14.log', 'alune-2026-10-15.log']);

    writeFileSync(join(dir, 'logs', 'alune-2026-09-01.log'), '{}\n');
    logs.update({
      customDirectory: null,
      level: 'INFO',
      retentionDays: 2,
      maxTotalMB: 20,
    });
    expect(files()).toEqual(['alune-2026-10-14.log', 'alune-2026-10-15.log']);
    logs.update({
      customDirectory: null,
      level: 'INFO',
      retentionDays: 1,
      maxTotalMB: 20,
    });
    expect(files()).toEqual(['alune-2026-10-15.log']);
  });

  it('starts a numbered file when the daily file reaches the size limit', () => {
    const logs = create();
    const big = join(dir, 'logs', 'alune-2026-10-14.log');
    writeFileSync(big, 'x'.repeat(20 * 1024 * 1024));
    logs.write('INFO', 'a', 'after limit');
    logs.flush();
    expect(files()).toEqual(['alune-2026-10-14.1.log', 'alune-2026-10-14.log']);
  });

  it('deletes the oldest files once the total exceeds the cap', () => {
    for (const [index, day] of ['10', '11', '12'].entries()) {
      const path = join(dir, 'logs', `alune-2026-10-${day}.log`);
      require('node:fs').mkdirSync(join(dir, 'logs'), { recursive: true });
      writeFileSync(path, 'x'.repeat(9 * 1024 * 1024));
      utimesSync(
        path,
        new Date(2026, 9, 10 + index),
        new Date(2026, 9, 10 + index),
      );
    }
    writeFileSync(
      join(dir, 'logging.json'),
      JSON.stringify({
        customDirectory: null,
        level: 'INFO',
        retentionDays: 30,
        maxTotalMB: 20,
      }),
    );
    create();
    expect(files()).toEqual(['alune-2026-10-11.log', 'alune-2026-10-12.log']);
  });

  it('loads recent history from disk', () => {
    const first = create();
    first.write('INFO', 'app', 'before restart');
    first.close();
    expect(
      create()
        .recent()
        .map((entry) => entry.message),
    ).toContain('before restart');
  });

  it('rejects an unwritable custom directory and falls back at startup', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const locked = join(dir, 'locked');
    require('node:fs').mkdirSync(locked);
    chmodSync(locked, 0o500);
    try {
      const logs = create();
      expect(() =>
        logs.update({
          customDirectory: locked,
          level: 'INFO',
          retentionDays: 3,
          maxTotalMB: 50,
        }),
      ).toThrow('没有写入权限');
      logs.close();
      writeFileSync(
        join(dir, 'logging.json'),
        JSON.stringify({
          customDirectory: locked,
          level: 'INFO',
          retentionDays: 3,
          maxTotalMB: 50,
        }),
      );
      const settings = create().settings();
      expect(settings.directory).toBe(join(dir, 'logs'));
      expect(settings.fallbackReason).toContain('已回退到默认目录');
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it('writes to a custom directory', () => {
    const custom = join(dir, 'custom');
    const logs = create();
    logs.update({
      customDirectory: custom,
      level: 'INFO',
      retentionDays: 3,
      maxTotalMB: 50,
    });
    logs.write('INFO', 'a', 'in custom');
    logs.flush();
    expect(lines('alune-2026-10-14.log', custom).at(-1).message).toBe(
      'in custom',
    );
  });
});
