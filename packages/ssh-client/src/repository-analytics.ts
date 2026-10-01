import { ANALYTICS_DAY_MS } from '@alune/shared';
import type { RepositoryAnalytics } from '@alune/shared';
import { runGit } from './repository-transport';
import type { RepositoryTransport } from './repository-transport';

const EXTENSIONS: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  h: 'C',
  cc: 'C++',
  cpp: 'C++',
  hpp: 'C++',
  cs: 'C#',
  rb: 'Ruby',
  php: 'PHP',
  vue: 'Vue',
  svelte: 'Svelte',
  dart: 'Dart',
  sh: 'Shell',
  css: 'CSS',
  scss: 'CSS',
  html: 'HTML',
  sql: 'SQL',
  lua: 'Lua',
  ex: 'Elixir',
};
export function primaryLanguage(paths: string[]): string | null {
  const counts = new Map<string, number>();
  for (const path of new Set(paths)) {
    if (
      /(^|\/)(node_modules|vendor|dist|build|coverage|target|generated|\.next|\.git)(\/|$)/i.test(
        path,
      ) ||
      /(?:\.min\.[^.]+|\.generated\.[^.]+|\.g\.cs|\.d\.ts)$/i.test(path)
    )
      continue;
    const language = EXTENSIONS[path.slice(path.lastIndexOf('.') + 1).toLowerCase()];
    if (language) counts.set(language, (counts.get(language) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))[0]?.[0] ?? null;
}

export async function collectRepositoryAnalytics(
  connection: RepositoryTransport,
  path: string,
  endDay: string,
  signal?: AbortSignal,
): Promise<RepositoryAnalytics> {
  const end = Date.parse(endDay + 'T00:00:00Z');
  if (!Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== endDay)
    throw new Error('无效的统计日期');
  const start = end - 180 * ANALYTICS_DAY_MS;
  const read = async (args: string[], maxOutputBytes = 2 * 1024 * 1024) => {
    const result = await runGit(connection, path, args, signal, { maxOutputBytes });
    if (result.exitCode !== 0) throw new Error(result.stderr || '无法读取仓库统计');
    return result.stdout;
  };
  // Verify the repository before interpreting a missing HEAD as an unborn branch.
  await read(['rev-parse', '--git-dir']);
  const head = await runGit(connection, path, ['rev-parse', '--verify', '--quiet', 'HEAD'], signal);
  let unborn = false;
  if (head.exitCode !== 0) {
    const symbolic = await runGit(connection, path, ['symbolic-ref', '-q', 'HEAD'], signal);
    if (symbolic.exitCode !== 0) throw new Error('无法解析 HEAD');
    const exists = await runGit(
      connection,
      path,
      ['show-ref', '--verify', '--quiet', symbolic.stdout.trim()],
      signal,
    );
    if (exists.exitCode !== 1) throw new Error('HEAD 引用损坏或不可读取');
    unborn = true;
  }
  const shallow = (await read(['rev-parse', '--is-shallow-repository'])).trim() === 'true';
  const daily = Array<number>(180).fill(0);
  const timestamps = unborn
    ? []
    : (
        await read([
          'log',
          '--no-show-signature',
          '--format=%ct',
          '--max-count=100001',
          `--since-as-filter=${new Date(start).toISOString()}`,
          head.stdout.trim(),
          '--',
        ])
      )
        .trim()
        .split('\n')
        .filter(Boolean);
  for (const value of timestamps.slice(0, 100000)) {
    const time = Number(value) * 1000;
    if (!Number.isFinite(time)) throw new Error('提交时间无法解析');
    if (time >= start && time < end) daily[Math.floor((time - start) / ANALYTICS_DAY_MS)]++;
  }
  let language: string | null = null;
  let languageError: string | undefined;
  let sampledFiles = 0;
  try {
    // Index names only: no working-tree recursion, file content reads or symlink traversal.
    const paths = (await read(['ls-files', '-z', '--cached'], 4 * 1024 * 1024))
      .split('\0')
      .filter(Boolean);
    if (paths.length > 100000) throw new Error('语言文件数量超过 100000 上限');
    sampledFiles = paths.length;
    language = primaryLanguage(paths);
  } catch (error) {
    signal?.throwIfAborted();
    languageError = error instanceof Error ? error.message : '语言读取失败';
  }
  return {
    endDay,
    daily,
    shallow,
    unborn,
    truncated: timestamps.length > 100000,
    language,
    languageError,
    sampledFiles,
    collectedAt: Date.now(),
  };
}
