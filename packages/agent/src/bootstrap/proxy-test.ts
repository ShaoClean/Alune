import { isRecord, ProtocolError, type ResourceRef } from '@alune/protocol';
import type { Handler } from '../ports/handler';
import type { settingsKernel } from './settings-kernel';
import type { ProxyRuntime } from '../adapters/network/runtime';
import type { hostsKernel } from './hosts';
import type { RepositoryCatalog } from '../modules/repositories/catalog';

export function proxyTest(
  settings: ReturnType<typeof settingsKernel>,
  network: ProxyRuntime,
  hosts: ReturnType<typeof hostsKernel>,
  catalog: RepositoryCatalog,
): Handler {
  return {
    effect: 'query',
    validate(v) {
      if (
        !isRecord(v) ||
        typeof v.revision !== 'string' ||
        !['http', 'ssh', 'git'].includes(String(v.kind))
      )
        throw new ProtocolError('invalid-params', '无效的连接测试。');
    },
    async run(p, ctx) {
      const { revision, kind, url, connectionId, repositoryId } = p as Record<string, string>;
      settings.proxy.assertRevision(revision);
      if (!settings.proxy.read().enabled)
        throw new ProtocolError('invalid-params', '请先保存并启用代理。');
      const start = performance.now(),
        signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]);
      let message = '',
        success = false;
      try {
        if (kind === 'http') {
          const target = new URL(url);
          if (
            url.length > 2048 ||
            !['http:', 'https:'].includes(target.protocol) ||
            target.username ||
            target.password
          )
            throw new ProtocolError('invalid-params', '测试地址必须是不含凭据的 HTTP(S) URL。');
          await settings.readyCredentials(signal);
          const response = await network.fetch(target, {
            method: 'HEAD',
            redirect: 'error',
            signal,
          });
          await response.body?.cancel();
          if (!response.ok)
            throw new ProtocolError('unavailable', '目标返回 HTTP ' + response.status);
          message = 'HTTP 测试成功。';
        } else if (kind === 'ssh') {
          await hosts.probeAuthentication(
            connectionId,
            (p as Record<string, unknown>).hostKey,
            signal,
          );
          message = 'SSH 测试成功，已通过当前保存的代理完成身份认证。';
        } else {
          let resource: ResourceRef | undefined;
          if (kind === 'git') {
            const repo = catalog.get({ agentId: ctx.agentId, resourceId: repositoryId }, false);
            if (repo.connectionId !== connectionId)
              throw new ProtocolError('invalid-params', '仓库不属于所选服务器。');
            resource = catalog.hostBinding(repo.id)?.resource;
            if (!resource) throw new ProtocolError('unavailable', '请先打开此 SSH 仓库。');
          }
          await hosts.testProxy(connectionId, resource, ctx.sessionId, signal);
          message = '已通过转发代理只读验证仓库远程地址。';
        }
        signal.throwIfAborted();
        success = true;
      } catch (error) {
        message =
          error instanceof ProtocolError
            ? error.message
            : '连接测试失败，请检查代理、目标和认证信息。';
      }
      settings.proxy.assertRevision(revision);
      return { revision, success, message, elapsedMs: Math.round(performance.now() - start) };
    },
  };
}
