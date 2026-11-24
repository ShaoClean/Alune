import type { ResourceRef } from '@alune/domain';
import {
  ProtocolError,
  isOperationId,
  repositoryShape,
  validateResource,
  validateWriteIntent,
  type JsonValue,
  type RepositoryResource,
} from '@alune/protocol';
import type { WriteCatalog } from '../modules/git/actions';
import { readTrackingBranch } from '../modules/git/background-fetch';
import { GitWorktrees, worktreePathKey } from '../modules/git/worktrees';
import { runGit } from '../modules/git/repository-transport';
import { RepositoryCatalog } from '../modules/repositories/catalog';
import { RepositoryReader } from '../modules/repositories/reads';
import type { RepositoryTransport } from '../ports/repository-files';
import type { Handler, HandlerContext } from '../ports/handler';
import { redactText } from '../adapters/logging/redact';
import { GitProxyError } from '../adapters/git/local-git-proxy';
import { commandObserver } from '../runtime/command-events';

const key = (path: string) =>
  process.platform === 'win32' ? worktreePathKey(path).toLowerCase() : worktreePathKey(path);
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
export function repositoryWrites(
  catalog: RepositoryCatalog,
  connect: (signal: AbortSignal, write?: boolean) => Promise<RepositoryTransport>,
  changed: (c: HandlerContext, r: ResourceRef) => unknown,
  terminals: Pick<WriteCatalog, 'withoutTerminals'>,
): Record<string, Handler> {
  type Active = {
    operationId: string;
    kind: string;
    startedAt: number;
    controller: AbortController;
    progress?: string;
  };
  const active = new Map<string, Active>(),
    common = new Set<string>();
  const state = (a?: Active) =>
    a
      ? {
          operationId: a.operationId,
          kind: a.kind,
          startedAt: a.startedAt,
          cancelling: a.controller.signal.aborted,
          ...(a.progress ? { progress: a.progress } : {}),
        }
      : null;
  const resourceParam = (p: unknown) => {
    repositoryShape(p, ['resource']);
    validateResource(p.resource);
  };
  return {
    'repositories.prepareWrite': {
      minimumProtocolMinor: 3,
      effect: 'query',
      validate: (p) => {
        validateWriteIntent(p);
      },
      async run(p, c) {
        const intent = validateWriteIntent(p),
          repo = catalog.get(intent.resource);
        const transport = await connect(AbortSignal.any([c.signal, AbortSignal.timeout(120000)]));
        try {
          const { writeRevision } = await import('../modules/repositories/write-revision');
          return { revision: await writeRevision(new RepositoryReader(transport), repo, intent) };
        } catch (error) {
          transport.signal?.throwIfAborted();
          if (error instanceof ProtocolError) throw error;
          throw new ProtocolError(
            'invalid-params',
            redactText(error instanceof Error ? error.message : '无法核验仓库。'),
          );
        } finally {
          await transport.close?.();
        }
      },
    },
    'repositories.operation': {
      minimumProtocolMinor: 3,
      effect: 'query',
      validate: resourceParam,
      run(p) {
        const { resource } = p as unknown as { resource: ResourceRef };
        catalog.get(resource);
        return json(state(active.get(resource.resourceId)));
      },
    },
    'repositories.cancelWrite': {
      minimumProtocolMinor: 3,
      effect: 'mutation',
      durable: false,
      validate(p) {
        repositoryShape(p, ['resource', 'operationId']);
        validateResource(p.resource);
        if (!isOperationId(p.operationId))
          throw new ProtocolError('invalid-params', 'Invalid operation ID');
      },
      run(p) {
        const { resource, operationId } = p as unknown as {
          resource: ResourceRef;
          operationId: string;
        };
        catalog.get(resource);
        const a = active.get(resource.resourceId);
        if (!a || a.operationId !== operationId)
          throw new ProtocolError('conflict', '操作已结束或已被替换。');
        a.controller.abort();
        return { success: true };
      },
    },
    'repositories.write': {
      minimumProtocolMinor: 3,
      effect: 'mutation',
      validate: (p) => {
        validateWriteIntent(p, true);
      },
      operationId: (p) => validateWriteIntent(p, true).operationId,
      async run(p, c) {
        const intent = validateWriteIntent(p, true),
          repo = catalog.get(intent.resource);
        const background = intent.kind === 'backgroundFetch';
        if (active.has(repo.id)) throw new ProtocolError('busy', '此仓库正在执行写操作。');
        const controller = new AbortController(),
          signal = AbortSignal.any([controller.signal, c.signal, AbortSignal.timeout(300000)]);
        const a: Active = {
          operationId: intent.operationId,
          kind: intent.kind,
          startedAt: Date.now(),
          controller,
        };
        active.set(repo.id, a);
        const notify = () =>
          c.events.notifyState('repositories.operation', json(state(a)), repo.resource);
        let lock: string | undefined,
          reader: RepositoryTransport | undefined,
          writer: RepositoryTransport | undefined,
          executing = false;
        const affected = new Map<string, ResourceRef>([[repo.id, repo.resource]]);
        try {
          notify();
          reader = await connect(signal);
          const [{ writeRevision }, { Actions }] = await Promise.all([
            import('../modules/repositories/write-revision'),
            import('./repository-actions'),
          ]);
          const trees = new GitWorktrees(reader);
          const result = await runGit(reader, repo.path, [
            'rev-parse',
            '--path-format=absolute',
            '--git-common-dir',
          ]);
          if (result.exitCode !== 0)
            throw new ProtocolError('invalid-params', '仓库已移动或无法访问。');
          const path = key(await trees.canonicalPath(result.stdout.replace(/\r?\n$/, '')));
          if (common.has(path))
            throw new ProtocolError('busy', '共享 Git 数据的 Worktree 正在执行写操作。');
          common.add(path);
          lock = path;
          const members = new Set((await trees.list(repo.path)).map((w) => key(w.path)));
          for (const r of catalog.list())
            if (r.source === 'local' && members.has(key(r.path))) affected.set(r.id, r.resource);
          if ((await writeRevision(new RepositoryReader(reader), repo, intent)) !== intent.revision)
            throw new ProtocolError('conflict', '仓库或文件已变化，请重新预览。');
          writer = await connect(signal, true);
          const native = writer;
          let lastProgress = 0;
          const progress = (chunk: string) => {
            const line = chunk
              .split(/[\r\n]/)
              .reverse()
              .find((v) =>
                /(LFS|Uploading|Downloading|Smudge|Receiving objects|Writing objects)/i.test(v),
              );
            if (line) {
              a.progress = redactText(line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')).slice(0, 400);
              if (Date.now() - lastProgress >= 150) {
                lastProgress = Date.now();
                notify();
              }
            }
          };
          const transport: RepositoryTransport = {
            signal,
            withSftp: native.withSftp.bind(native),
            hasAnyPath: native.hasAnyPath?.bind(native),
            execCommand: native.execCommand.bind(native),
            execGit: (root, args, abort, options) =>
              native.execGit!(root, args, abort, {
                ...options,
                observe: background
                  ? undefined
                  : commandObserver(c, repo.resource, intent.operationId),
                environment: {
                  ...options?.environment,
                  ...(['push', 'pull'].includes(intent.kind)
                    ? { GIT_LFS_FORCE_PROGRESS: '1' }
                    : {}),
                },
                onStdout: (s) => {
                  options?.onStdout?.(s);
                  progress(s);
                },
                onStderr: (s) => {
                  options?.onStderr?.(s);
                  progress(s);
                },
              }),
          };
          const registry: WriteCatalog = {
            async addLocal(path) {
              const info = await new RepositoryReader(reader!).inspect(path);
              const r = catalog.register(info.path, info.name, info.worktreeKind);
              affected.set(r.id, r.resource);
              return r;
            },
            async list() {
              return catalog.list();
            },
            async delete(id) {
              return catalog.unregister({ agentId: catalog.agentId, resourceId: id });
            },
            withoutTerminals: (ids, work) => terminals.withoutTerminals(ids, work),
          };
          const actions = new Actions(registry, repo, transport, (kind) => {
            if (a.kind !== kind) {
              a.kind = kind;
              notify();
            }
          });
          const method =
            intent.kind === 'submodules'
              ? 'updateSubmodules'
              : intent.kind === 'deleteNewFile'
                ? 'removeNewFile'
                : intent.kind;
          signal.throwIfAborted();
          catalog.get(repo.resource);
          if (intent.kind === 'pull' && intent.args.length > 2) {
            const [, , branch, head, upstream] = intent.args;
            const current = await readTrackingBranch(reader, repo.path);
            if (
              current?.branch !== branch ||
              current?.head !== head ||
              current?.upstream !== upstream
            )
              throw new ProtocolError(
                'conflict',
                '当前分支或上游已变化，请刷新后再拉取。',
                'not-started',
                {
                  code: 'SYNC_TARGET_CHANGED',
                },
              );
          }
          if (!background) for (const resource of affected.values()) changed(c, resource);
          executing = true;
          // validateWriteIntent restricted method and arguments to the public allowlist.
          const invoke = actions[method] as (id: string, ...args: unknown[]) => Promise<unknown>;
          return json(
            await invoke.call(
              actions,
              repo.id,
              ...(intent.kind === 'pull' ? intent.args.slice(0, 2) : intent.args).map((v) =>
                v === null ? undefined : v,
              ),
            ),
          );
        } catch (error) {
          if (signal.aborted)
            throw new ProtocolError(
              signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled',
              '操作已中断，请核对仓库状态。',
              executing ? 'unknown' : 'not-started',
            );
          if (background && error instanceof GitProxyError)
            throw new ProtocolError('unavailable', redactText(error.message), 'unknown', {
              code: 'PROXY_UNAVAILABLE',
            });
          if (error instanceof ProtocolError) {
            if (!executing || error.details || error.outcome === 'unknown') throw error;
            throw new ProtocolError(error.kind, redactText(error.message), 'unknown');
          }
          throw new ProtocolError(
            'unavailable',
            redactText(error instanceof Error ? error.message : 'Git 操作失败。'),
            executing ? 'unknown' : 'not-started',
          );
        } finally {
          try {
            await Promise.all([reader?.close?.(), writer?.close?.()]);
          } finally {
            if (lock !== undefined) common.delete(lock);
            active.delete(repo.id);
            if (executing) for (const r of affected.values()) changed(c, r);
            c.events.notifyState('repositories.operation', null, repo.resource);
          }
        }
      },
    },
  };
}
