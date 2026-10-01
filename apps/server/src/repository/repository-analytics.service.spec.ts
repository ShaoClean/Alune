import { RepositoryAnalyticsService } from './repository-analytics.service';
import { RepositoryService } from './repository.service';
import * as transport from '@alune/ssh-client';
import { ANALYTICS_CACHE_MS } from '@alune/shared';

const data = () => ({
  endDay: new Date().toISOString().slice(0, 10),
  daily: Array(180).fill(0),
  shallow: false,
  truncated: false,
  unborn: false,
  language: 'TypeScript',
  sampledFiles: 1,
  collectedAt: Date.now(),
});
const repos = Array.from({ length: 10 }, (_, i) => ({
  id: `${i}`,
  source: 'ssh' as const,
  connectionId: `host-${i % 4}`,
  name: `repo-${i}`,
  path: `/repo-${i}`,
}));
function setup() {
  const connection = jest.fn().mockResolvedValue({});
  const repository = { list: jest.fn().mockResolvedValue(repos), connection };
  return {
    service: new RepositoryAnalyticsService(
      repository as unknown as RepositoryService,
    ),
    repository,
    connection,
  };
}
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('cache-only opening never probes, validates batches, ignores removed IDs', async () => {
  const { service, connection } = setup();
  expect(await service.batch({ ids: ['0', '0', 'missing'] })).toEqual([
    { id: '0' },
    { id: 'missing', error: expect.any(String) },
  ]);
  expect(connection).not.toHaveBeenCalled();
  for (const body of [
    { ids: Array(21).fill('0') },
    { ids: [1] },
    { ids: ['0'], collect: 'yes' },
    {},
  ]) {
    await expect(service.batch(body)).rejects.toThrow();
  }
});
test('global concurrency <= 3, per SSH source <= 1, concurrent requests coalesce and cache expires', async () => {
  const { service, connection } = setup();
  let active = 0,
    peak = 0;
  const hosts = new Set<string>();
  jest
    .spyOn(transport, 'collectRepositoryAnalytics')
    .mockImplementation(async (_connection, path) => {
      const source = repos.find((repo) => repo.path === path)!.connectionId;
      expect(hosts.has(source)).toBe(false);
      hosts.add(source);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      hosts.delete(source);
      return data();
    });
  const ids = repos.map((repo) => repo.id);
  const [first, duplicate] = await Promise.all([
    service.batch({ ids, collect: true }),
    service.batch({ ids, collect: true }),
  ]);
  expect(first).toEqual(duplicate);
  expect(connection).toHaveBeenCalledTimes(10);
  expect(peak).toBe(3);
  await service.batch({ ids, collect: true });
  expect(connection).toHaveBeenCalledTimes(10);
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + ANALYTICS_CACHE_MS + 1);
  await service.batch({ ids: ['0'], collect: true });
  expect(connection).toHaveBeenCalledTimes(11);
});
test('unreachable SSH is isolated and cooled down, timeout aborts before late Git work', async () => {
  jest.useFakeTimers();
  const { service, connection } = setup();
  let late!: (value: object) => void;
  connection.mockImplementation((repo) =>
    repo.connectionId === 'host-0'
      ? new Promise((resolve) => {
          late = resolve;
        })
      : Promise.resolve({}),
  );
  const collect = jest
    .spyOn(transport, 'collectRepositoryAnalytics')
    .mockImplementation(async () => data());
  const pending = service.batch({ ids: ['0', '1', '4'], collect: true });
  await jest.advanceTimersByTimeAsync(10001);
  const results = await pending;
  expect(results[0].error).toMatch(/超时/);
  expect(results[1].data).toBeDefined();
  expect(results[2].error).toMatch(/30 秒/);
  expect(connection).toHaveBeenCalledTimes(2);
  late({});
  await Promise.resolve();
  await Promise.resolve();
  expect(collect).toHaveBeenCalledTimes(1);
});
test('failed refresh retains old values with error; registry deletion prunes cache', async () => {
  const { service, repository } = setup();
  const collect = jest
    .spyOn(transport, 'collectRepositoryAnalytics')
    .mockResolvedValue(data());
  const [first] = await service.batch({ ids: ['0'], collect: true });
  collect.mockRejectedValue(new Error('broken repository'));
  const [failed] = await service.batch({
    ids: ['0'],
    collect: true,
    refresh: true,
  });
  expect(failed.data).toEqual(first.data);
  expect(failed.error).toMatch(/broken/);
  repository.list.mockResolvedValue([]);
  expect(await service.batch({ ids: ['0'] })).toEqual([
    { id: '0', error: expect.any(String) },
  ]);
});

test('retrying during SSH cooldown does not keep extending it', async () => {
  jest.useFakeTimers();
  const { service, connection } = setup();
  connection.mockRejectedValue(new Error('offline'));
  await service.batch({ ids: ['0'], collect: true });
  await jest.advanceTimersByTimeAsync(10000);
  await service.batch({ ids: ['0'], collect: true });
  expect(connection).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(20001);
  await service.batch({ ids: ['0'], collect: true });
  expect(connection).toHaveBeenCalledTimes(2);
});
