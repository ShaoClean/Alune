import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  GitCommands,
  GitProxyError,
  ProxyTransportError,
} from '@alune/ssh-client';
import type { ProxyTestResult, SaveNetworkProxy } from '@alune/shared';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';
import { ProxyService } from './proxy.service';

@Controller('network-proxy')
export class ProxyController {
  constructor(
    private proxy: ProxyService,
    private connections: ConnectionService,
    private repositories: RepositoryService,
  ) {}

  @Get()
  settings() {
    return this.proxy.settings.read();
  }

  @Put()
  save(@Body() input: SaveNetworkProxy) {
    return this.proxy.settings.save(input);
  }

  @Get('connections')
  statuses() {
    return this.connections.proxyStatuses();
  }

  @Post('connections/:id/reconnect')
  reconnect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { revision: string },
  ) {
    return this.connections.reconnectProxy(id, body?.revision);
  }

  @Post('test')
  async test(
    @Body()
    body: {
      kind: 'http' | 'ssh' | 'git';
      revision: string;
      url?: string;
      connectionId?: string;
      repositoryId?: string;
    },
    @Req() request: Request,
  ): Promise<ProxyTestResult> {
    this.proxy.settings.assertRevision(body?.revision);
    if (!this.proxy.settings.read().enabled)
      throw new BadRequestException('请先保存并启用代理，再进行连接测试。');
    if (!['http', 'ssh', 'git'].includes(body.kind))
      throw new BadRequestException('无效的测试类型。');
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.res?.once('close', abort);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30_000),
    ]);
    const started = performance.now();
    let success = false;
    let message = '';
    try {
      if (body.kind === 'http') {
        let url: URL;
        try {
          if (typeof body.url !== 'string' || body.url.length > 2048)
            throw new Error();
          url = new URL(body.url);
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password
          )
            throw new Error();
        } catch {
          throw new BadRequestException(
            '测试地址必须为不含用户名或密码的 HTTP(S) URL。',
          );
        }
        const response = await this.proxy.fetch(url, {
          method: 'HEAD',
          redirect: 'error',
          signal,
        });
        await response.body?.cancel();
        if (!response.ok)
          throw new BadRequestException(
            `目标返回 HTTP ${response.status}，请检查测试地址与访问权限。`,
          );
        message = 'HTTP 测试成功。';
      } else if (body.kind === 'ssh') {
        if (!body.connectionId) throw new BadRequestException('请选择服务器。');
        await this.connections.testSavedProxy(body.connectionId, signal);
        message = 'SSH 测试成功，已通过当前保存的代理完成身份认证。';
      } else {
        if (!body.connectionId || !body.repositoryId)
          throw new BadRequestException('请选择服务器和该服务器上的仓库。');
        const repo = await this.repositories.get(body.repositoryId);
        if (repo.source === 'local' || repo.connectionId !== body.connectionId)
          throw new BadRequestException('请选择此服务器上的远端仓库。');
        const connection = await this.connections.ensureConnected(
          body.connectionId,
        );
        if (connection.proxyRevision !== body.revision)
          throw new BadRequestException(
            '此服务器需先重新连接并应用当前代理配置。',
          );
        const release = connection.holdTask();
        try {
          await connection.prepareGitProxy();
          const remotes = await new GitCommands(connection).remoteList(
            repo.path,
            signal,
          );
          if (!remotes.length)
            throw new BadRequestException('此仓库尚未配置远程地址。');
          // Test every distinct fetch/push URL using ls-remote. This never commits,
          // updates worktrees, or pushes, and validates SSH and HTTPS independently.
          const urls = [
            ...new Set(
              remotes
                .flatMap((remote) => [remote.fetchUrl, remote.pushUrl])
                .filter(Boolean),
            ),
          ];
          if (urls.length > 20)
            throw new BadRequestException(
              '此仓库远程地址超过 20 个，请使用远程地址较少的测试仓库。',
            );
          for (const url of urls) {
            if (!/^(https?:\/\/|ssh:\/\/|[^/\s:]+@[^/\s:]+:)/.test(url))
              throw new BadRequestException(
                'Git 连接测试仅支持 HTTP(S) 和 SSH 远程地址。',
              );
            const result = await connection.execGit(
              repo.path,
              ['ls-remote', '--heads', '--', url],
              signal,
              { maxOutputBytes: 1024 * 1024 },
            );
            if (result.exitCode !== 0)
              throw new BadRequestException(
                '远端 Git 连接测试失败，请检查代理、仓库权限、SSH 密钥与 known_hosts，以及远端 Python 3 / OpenSSH。',
              );
          }
          message = `远端 Git 测试成功，已通过转发只读验证 ${urls.length} 个地址。`;
        } finally {
          release();
        }
      }
      signal.throwIfAborted();
      success = true;
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      message = signal.aborted
        ? '连接测试已取消或超时，请重试。'
        : error instanceof HttpException ||
            error instanceof ProxyTransportError ||
            error instanceof GitProxyError
          ? error.message
          : cause instanceof ProxyTransportError
            ? cause.message
            : body.kind === 'ssh'
              ? 'SSH 连接失败，请检查代理、服务器地址和 SSH 认证信息。'
              : '连接失败，请检查代理地址、认证、目标权限与 TLS 证书。';
    } finally {
      request.res?.removeListener('close', abort);
    }
    this.proxy.settings.assertRevision(body.revision);
    return {
      revision: body.revision,
      success,
      elapsedMs: Math.round(performance.now() - started),
      message,
    };
  }
}
