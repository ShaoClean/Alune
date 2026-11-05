import { writeWorkspaceText } from '../adapters/files/workspace-text';
import type { BranchNameConflict, ResourceRef } from '@alune/domain';
import {
  ProtocolError,
  isOperationId,
  repositoryShape,
  validateResource,
  validateWriteIntent,
  type JsonValue,
  type RepositoryResource,
} from '@alune/protocol';
import { GitActions, type GitAction, type WriteCatalog } from '../modules/git/actions';
import { GitCommands } from '../modules/git/git-commands-writes';
import { GitWorktrees, worktreePathKey } from '../modules/git/worktrees';
import { InteractiveRebase } from '../modules/git/interactive-rebase';
import { runGit } from '../modules/git/repository-transport';
import { RepositoryCatalog } from '../modules/repositories/catalog';
import { RepositoryReader } from '../modules/repositories/reads';
import { writeRevision } from '../modules/repositories/write-revision';
import type { RepositoryTransport } from '../ports/repository-files';
import type { Handler, HandlerContext } from '../ports/handler';
import { redactText } from '../adapters/logging/redact';

class Invalid extends ProtocolError {
  constructor(message: string) {
    super('invalid-params', message);
  }
}
class Conflict extends ProtocolError {
  constructor(failure: string | BranchNameConflict) {
    super(
      'conflict',
      typeof failure === 'string' ? failure : failure.message,
      'not-started',
      typeof failure === 'string' ? undefined : JSON.parse(JSON.stringify(failure)),
    );
  }
}
class ActionFailure extends ProtocolError {
  constructor(message: string, status: number) {
    super(
      status === 409 ? 'conflict' : status === 400 ? 'invalid-params' : 'unavailable',
      message,
      'unknown',
    );
  }
}
class Actions extends GitActions {
  constructor(
    registry: WriteCatalog,
    readonly repo: RepositoryResource,
    readonly transport: RepositoryTransport,
    readonly onKind: (kind: string) => void,
  ) {
    super(registry, { invalid: Invalid, conflict: Conflict, status: ActionFailure });
  }
  writeFile(id: string, path: string, content: string, token: string) {
    return this.write(id, 'write-file', (_git, repo, transport) =>
      writeWorkspaceText(transport, repo.path, path, content, token),
    );
  }
  protected async write<T>(_id: string, kind: string, operation: GitAction<T>) {
    this.onKind(kind);
    if (
      ![
        'stage',
        'unstage',
        'interactive-rebase',
        'rebase-conflict',
        'resolve-conflict',
        'conflict-continue',
        'conflict-skip',
        'conflict-abort',
      ].includes(kind) &&
      (await new InteractiveRebase(this.transport).state(this.repo.path)).managed
    )
      throw new Conflict('请先完成或中止当前交互式变基。');
    return operation(new GitCommands(this.transport), this.repo, this.transport);
  }
}
const key = (path: string) =>
  process.platform === 'win32' ? worktreePathKey(path).toLowerCase() : worktreePathKey(path);
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
export function repositoryWrites(
  catalog: RepositoryCatalog,
  connect: (signal: AbortSignal, write?: boolean) => Promise<RepositoryTransport>,
  changed: (c: HandlerContext, r: ResourceRef) => unknown,
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
          return { revision: await writeRevision(new RepositoryReader(transport), repo, intent) };
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
        if (!isOperationId(p.operationId)) throw new Invalid('Invalid operation ID');
      },
      run(p) {
        const { resource, operationId } = p as unknown as {
          resource: ResourceRef;
          operationId: string;
        };
        catalog.get(resource);
        const a = active.get(resource.resourceId);
        if (!a || a.operationId !== operationId) throw new Conflict('操作已结束或已被替换。');
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
          const trees = new GitWorktrees(reader);
          const result = await runGit(reader, repo.path, [
            'rev-parse',
            '--path-format=absolute',
            '--git-common-dir',
          ]);
          if (result.exitCode !== 0) throw new Invalid('仓库已移动或无法访问。');
          const path = key(await trees.canonicalPath(result.stdout.replace(/\r?\n$/, '')));
          if (common.has(path))
            throw new ProtocolError('busy', '共享 Git 数据的 Worktree 正在执行写操作。');
          common.add(path);
          lock = path;
          const members = new Set((await trees.list(repo.path)).map((w) => key(w.path)));
          for (const r of catalog.list())
            if (r.source === 'local' && members.has(key(r.path))) affected.set(r.id, r.resource);
          if ((await writeRevision(new RepositoryReader(reader), repo, intent)) !== intent.revision)
            throw new Conflict('仓库或文件已变化，请重新预览。');
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
            // This isolated Agent does not host terminals until P5. Its shared
            // directory lock is held through Git removal and catalog updates.
            withoutTerminals: (_ids, work) => work(),
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
          for (const resource of affected.values()) changed(c, resource);
          executing = true;
          // validateWriteIntent restricted method and arguments to the public allowlist.
          const invoke = actions[method] as (id: string, ...args: unknown[]) => Promise<unknown>;
          return json(
            await invoke.call(
              actions,
              repo.id,
              ...intent.args.map((v) => (v === null ? undefined : v)),
            ),
          );
        } catch (error) {
          if (signal.aborted)
            throw new ProtocolError(
              signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled',
              '操作已中断，请核对仓库状态。',
              executing ? 'unknown' : 'not-started',
            );
          if (error instanceof ProtocolError) throw error;
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
