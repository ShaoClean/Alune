import { confirmTerminalRemoval } from '../stores/terminalRemoval';
import { AgentClient, openRemoteAgent, openLegacyRepository } from '@alune/agent-client';
import {
  validateRepositoryResource,
  ProtocolError,
  isRecord,
  type RepositoryResource,
  type ResourceRef,
} from '@alune/protocol';
import { aiApi } from './ai';
import { loggingApi } from './logging';
import { proxyApi } from './proxy';
import {
  repositoryApi,
  gitApi,
  fileApi,
  accessTokenApi,
  connectionApi,
  pullRequestCenterApi,
} from './index';
import { createAgentRepositoryQueries, createAgentFileWrite } from './agent-repositories';
import { createAgentCollaboration } from './agent-collaboration';
import { workspaceTopics } from './ui-agent';
import { hostConsent } from './host-consent';

type Binding = { localId: string; resource: ResourceRef };
type Host = {
  hostId: string;
  hostKey: string | null;
  state: string;
  reason: string | null;
  gitProxy: string | null;
  activeTasks: number;
  updatedAt: number;
  bindings: Binding[];
};
export type Target = { client: AgentClient; resource: ResourceRef; alias: RepositoryResource };
export let repositoryTarget: (id: string) => Promise<Target>;
export const agentOwners = new Set<AgentClient>();
const ownerListeners = new Set<(client: AgentClient) => void>();
export function observeOwners(listener: (client: AgentClient) => void) {
  ownerListeners.add(listener);
  for (const client of agentOwners) listener(client);
  return () => {
    ownerListeners.delete(listener);
  };
}
function addOwner(client: AgentClient) {
  agentOwners.add(client);
  for (const listener of ownerListeners) listener(client);
  client.onClose(() => agentOwners.delete(client));
}
const fail = () => {
  throw new Error('当前连接不支持此操作。');
};
function methods<T extends object>(template: T, run: (key: keyof T, ...args: any[]) => any): T {
  return Object.fromEntries(
    Object.keys(template).map((key) => [key, (...args: any[]) => run(key as keyof T, ...args)]),
  ) as T;
}
export async function installWorkspaceAgent(local: AgentClient, logsOnly = false) {
  const ref = (resourceId: string) => ({ agentId: local.initialized!.agentId, resourceId });
  let logRevision = '';
  Object.assign(loggingApi, {
    recent: (n: number) => local.recentLogs(n),
    settings: async () => {
      const r = await local.getLoggingSettings();
      logRevision = r.revision;
      return r.settings;
    },
    save: async (input) => {
      const r = await local.saveLoggingSettings(input, logRevision);
      logRevision = r.revision;
      return r.settings;
    },
    report: async (level, message, context) => {
      await local.request(
        'diagnostics.logs.client',
        JSON.parse(JSON.stringify({ level, message, context })),
      );
    },
  } satisfies typeof loggingApi);
  if (logsOnly) return;
  addOwner(local);
  const catalog = async () =>
    (await local.request('hosts.catalog', {})) as unknown as { hosts: Host[] };
  const clients = new Map<string, AgentClient>(),
    opening = new Map<string, Promise<AgentClient>>();
  function connect(id: string, interactive = false) {
    const active = clients.get(id);
    if (active?.state === 'ready') return Promise.resolve(active);
    const pending = opening.get(id);
    if (pending) return pending;
    const work = (async () => {
      const host = (await catalog()).hosts.find((h) => h.hostId === id);
      if (!host) throw new Error('服务器不存在。');
      if (!interactive && !host.hostKey) throw new Error('请先在连接页验证服务器指纹。');
      const policy = interactive
        ? await hostConsent(
            (await local.listHostProfiles()).hosts.find((h) => h.id === id)!.name,
            host.hostKey,
          )
        : { hostKey: host.hostKey!, install: false };
      const client = await openRemoteAgent(local, { hostId: id, ...policy });
      try {
        await client.subscribe(workspaceTopics);
      } catch (e) {
        client.close();
        throw e;
      }
      clients.set(id, client);
      addOwner(client);
      client.onClose(() => {
        if (clients.get(id) === client) clients.delete(id);
      });
      return client;
    })().finally(() => opening.delete(id));
    opening.set(id, work);
    return work;
  }
  const aliasFor = async (client: AgentClient, resource: ResourceRef) => {
    if (client === local) return client.getRepository(resource);
    await client.listRepositories();
    return validateRepositoryResource(
      await local.request('hosts.bindRepository', { resource: { ...resource } }),
    );
  };
  repositoryTarget = async (id: string) => {
    const alias = await local.getRepository(ref(id));
    if (alias.source === 'local') return { client: local, resource: alias.resource, alias };
    const hostId = alias.connectionId!,
      client = await connect(hostId);
    const host = (await catalog()).hosts.find((h) => h.hostId === hostId);
    const binding = host?.bindings.find((b) => b.localId === id);
    const resource =
      binding?.resource ?? (await openLegacyRepository(local, client, hostId, id)).resource;
    if (resource.agentId !== client.initialized?.agentId) throw new Error('服务器仓库身份不匹配。');
    return { client, resource, alias };
  };
  async function remove(kind: 'host' | 'repository', id: string) {
    const expected =
      kind === 'host'
        ? {
            revision: (await local.listHostProfiles()).revision,
            repositories: (await local.listRepositories())
              .filter((r) => r.connectionId === id)
              .map((r) => r.id),
          }
        : {};
    const submit = (sessions: string[]) =>
      local.request(
        'workspace.remove',
        JSON.parse(JSON.stringify({ kind, id, sessions, ...expected })),
      );
    try {
      return await submit([]);
    } catch (error) {
      if (
        !(error instanceof ProtocolError) ||
        error.outcome !== 'not-started' ||
        !isRecord(error.details) ||
        error.details.code !== 'TERMINAL_CONFIRM_REQUIRED' ||
        !Array.isArray(error.details.sessions)
      )
        throw error;
      const sessions = error.details
        .sessions as unknown as import('@alune/domain').TerminalSession[];
      if (!(await confirmTerminalRemoval(sessions))) throw new Error('已取消移除。');
      if (kind === 'repository')
        for (const session of sessions.filter((s) => s.source === 'ssh')) {
          const owner = clients.get(session.connectionId!);
          if (!owner) throw new Error('请在拥有该会话的窗口关闭终端。');
          await owner.request('terminals.close', { sessionId: session.requestId, confirmed: true });
        }
      return submit(sessions.map((s) => s.id));
    }
  }
  const queryAdapters = new WeakMap<AgentClient, ReturnType<typeof createAgentRepositoryQueries>>();
  function adapter(client: AgentClient) {
    let a = queryAdapters.get(client);
    if (!a) {
      a = createAgentRepositoryQueries(
        client,
        (id) => ({ agentId: client.initialized!.agentId, resourceId: id }),
        methods(repositoryApi, fail),
        methods(gitApi, fail),
      );
      queryAdapters.set(client, a);
      client.onClose(() => a!.dispose());
    }
    return a;
  }
  const collaboration = createAgentCollaboration(local, ref);
  Object.assign(aiApi, collaboration.ai);
  Object.assign(accessTokenApi, collaboration.accounts);
  Object.assign(pullRequestCenterApi, collaboration.center);
  const routed =
    (group: 'repository' | 'git') =>
    async (key: string, id: string, ...args: any[]) => {
      const { client, resource } = await repositoryTarget(id);
      const invoke = adapter(client)[group] as Record<string, (...args: any[]) => Promise<any>>;
      const value = await invoke[key](resource.resourceId, ...args);
      if (client !== local && key === 'context') return { ...value, source: 'ssh' };
      if (client !== local && ['createWorktree', 'openWorktree', 'openSubmodule'].includes(key))
        return aliasFor(client, validateRepositoryResource(value).resource);
      if (client !== local && key === 'removeWorktree') {
        const host = (await catalog()).hosts.find((h) => clients.get(h.hostId) === client);
        const ids =
          host?.bindings
            .filter((b) => value.removedIds.includes(b.resource.resourceId))
            .map((b) => b.localId) ?? [];
        for (const aliasId of ids) await local.unregisterRepository(ref(aliasId));
        return { removedIds: ids };
      }
      return value;
    };
  Object.assign(gitApi, methods(gitApi, routed('git')));
  Object.assign(
    repositoryApi,
    methods(repositoryApi, routed('repository')),
    collaboration.repository,
    {
      list: async (id?: string) =>
        (await local.listRepositories()).filter((r) => !id || r.connectionId === id),
      get: (id: string) => local.getRepository(ref(id)),
      pin: (id: string, pinned: boolean) => local.pinRepository(ref(id), pinned),
      delete: (id: string) => remove('repository', id),
      inspectLocal: (path: string) => local.inspectRepository(path),
      addLocal: (path: string) => local.registerRepository(path),
      add: async (id: string, path: string) => {
        const client = await connect(id);
        return aliasFor(client, (await client.registerRepository(path)).resource);
      },
      scan: async (id: string, path: string) =>
        ((await (await connect(id)).discoverRepositories(path)) as { paths: string[] }).paths,
      analytics: async (ids: string[], collect = false, refresh = false, signal?: AbortSignal) => {
        const groups = new Map<AgentClient, Target[]>();
        for (const id of ids) {
          const target = await repositoryTarget(id);
          const g = groups.get(target.client) ?? [];
          g.push(target);
          groups.set(target.client, g);
        }
        const rows = await Promise.all(
          [...groups].map(async ([client, targets]) => {
            const values = await client.repositoryAnalytics(
              targets.map((t) => t.resource),
              collect,
              refresh,
              { signal },
            );
            return values.map((r) => ({
              ...r,
              id: targets.find((t) => t.resource.resourceId === r.id)!.alias.id,
            }));
          }),
        );
        return rows.flat().sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      },
    },
  );
  Object.assign(connectionApi, {
    list: async () => {
      const [profiles, c] = await Promise.all([local.listHostProfiles(), catalog()]);
      return profiles.hosts.map((h) => {
        const route = c.hosts.find((r) => r.hostId === h.id);
        return {
          ...h,
          status: route?.state === 'ready' ? 'connected' : route?.reason ? 'error' : 'disconnected',
          updatedAt: route?.updatedAt ?? 0,
          error: route?.reason,
        };
      });
    },
    get: async (id: string) => (await local.listHostProfiles()).hosts.find((h) => h.id === id),
    create: async (profile) => {
      const before = await local.listHostProfiles();
      const after = await local.saveHostProfile(
        null,
        { ...profile, privateKeyPath: profile.privateKeyPath || null },
        before.revision,
      );
      return after.hosts.find((h) => !before.hosts.some((old) => old.id === h.id));
    },
    delete: async (id) => {
      await remove('host', id);
      clients.get(id)?.close();
    },
    test: async (id) => {
      const client = await connect(id, true);
      await client.health();
      return { success: true, status: 'connected', updatedAt: Date.now() };
    },
  } satisfies typeof connectionApi);
  Object.assign(proxyApi, {
    settings: () => local.getProxySettings(),
    save: (input) => local.saveProxySettings(input),
    connections: async () => {
      const [hosts, c, settings] = await Promise.all([
        local.listHostProfiles(),
        catalog(),
        local.getProxySettings(),
      ]);
      return hosts.hosts.map((h) => {
        const route = c.hosts.find((r) => r.hostId === h.id);
        return {
          id: h.id,
          name: h.name,
          connected: route?.state === 'ready',
          connecting: opening.has(h.id),
          revision: route?.state === 'ready' ? settings.revision : null,
          pendingReconnect: false,
          activeTasks: route?.activeTasks ?? 0,
          forwarding:
            route?.gitProxy === 'ready'
              ? 'ready'
              : route?.gitProxy === 'blocked'
                ? 'denied'
                : route?.state === 'ready'
                  ? 'disabled'
                  : 'disconnected',
        };
      });
    },
    reconnect: async (id, revision) => {
      if ((await local.getProxySettings()).revision !== revision)
        throw new Error('代理设置已变更。');
      await connect(id);
      return proxyApi.connections();
    },
    test: async (input, signal) => {
      if (input.kind !== 'http') {
        const client = await connect(input.connectionId);
        await client.health();
        if (input.kind === 'git') await repositoryTarget(input.repositoryId);
      }
      return (await local.request('network.testProxy', input, {
        signal,
        timeoutMs: 35000,
      })) as unknown as Awaited<ReturnType<typeof proxyApi.test>>;
    },
  } satisfies typeof proxyApi);
  async function locate(id: string, path: string) {
    const normalized = (p: string) => p.replaceAll('\\', '/').replace(/\/$/, '');
    const abs = normalized(path);
    const row = (await local.listRepositories())
      .filter(
        (r) =>
          r.connectionId === id &&
          (abs === normalized(r.path) || abs.startsWith(normalized(r.path) + '/')),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (!row) throw new Error('请在已登记仓库内选择文件。');
    return {
      ...(await repositoryTarget(row.id)),
      relativePath: abs.slice(normalized(row.path).length + 1),
    };
  }
  Object.assign(fileApi, {
    list: async (id, path) => {
      const t = await locate(id, path);
      const tree = await t.client.readRepository(t.resource, 'tree', { path: t.relativePath });
      return tree.entries.map((e) => ({
        name: e.name,
        isFile: e.kind === 'file',
        isDirectory: e.kind === 'directory',
        longname: e.name,
      }));
    },
    read: async (id, path) => {
      const t = await locate(id, path);
      const f = await t.client.readRepository(t.resource, 'file', { path: t.relativePath });
      if (f.kind !== 'text') throw new Error('文件不是可读取的文本。');
      return { content: f.content };
    },
    write: async (id, path, content) => {
      const t = await locate(id, path);
      return createAgentFileWrite(t.client, () => t, fail)(id, path, content);
    },
  } satisfies typeof fileApi);
}
