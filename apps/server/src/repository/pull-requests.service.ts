import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PullRequestItem,
  PullRequestPage,
  PullRequestQuery,
  PullRequestRemote,
} from '@alune/shared';
import { RepositoryService } from './repository.service';
import { pullRequestRemote } from './pull-request-remote';

const PAGE_SIZE = 30;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const PULL_REQUEST_TIMEOUT_MS = 20_000;

export function validatePullRequestQuery(value: unknown): PullRequestQuery {
  const query = value as PullRequestQuery | null;
  if (
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    typeof query.remote !== 'string' ||
    !query.remote ||
    query.remote.length > 256 ||
    typeof query.target !== 'string' ||
    !query.target ||
    query.target.length > 4096 ||
    !['github', 'gitlab'].includes(query.provider) ||
    !['open', 'all'].includes(query.state) ||
    !Number.isSafeInteger(query.page) ||
    query.page < 1 ||
    query.page > 10000 ||
    (query.token !== undefined &&
      (typeof query.token !== 'string' ||
        query.token.length > 4096 ||
        /[\s\x00-\x1f\x7f]/.test(query.token)))
  ) {
    throw new BadRequestException(
      '请选择有效的远端、平台、状态和页码；令牌不能包含空白字符。',
    );
  }
  return query;
}

function apiUrl(remote: PullRequestRemote, query: PullRequestQuery): URL {
  const url =
    query.provider === 'github'
      ? new URL(
          `https://api.github.com/repos/${remote.project.split('/').map(encodeURIComponent).join('/')}/pulls`,
        )
      : new URL(
          `https://${remote.host}/api/v4/projects/${encodeURIComponent(remote.project)}/merge_requests`,
        );
  url.searchParams.set(
    'state',
    query.state === 'open' && query.provider === 'gitlab'
      ? 'opened'
      : query.state,
  );
  url.searchParams.set('per_page', String(PAGE_SIZE));
  url.searchParams.set('page', String(query.page));
  if (query.provider === 'github') {
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('direction', 'desc');
  } else {
    url.searchParams.set('scope', 'all');
    url.searchParams.set('order_by', 'updated_at');
    url.searchParams.set('sort', 'desc');
  }
  return url;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body)
    throw new BadGatewayException('托管平台返回了空响应，请重试。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw new BadGatewayException('托管平台响应过大，请在浏览器中查看。');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function normalizeItem(
  value: any,
  remote: PullRequestRemote,
  query: PullRequestQuery,
): PullRequestItem {
  const github = query.provider === 'github';
  const number = github ? value?.number : value?.iid;
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    typeof value?.title !== 'string' ||
    !(
      github ? ['open', 'closed'] : ['opened', 'closed', 'merged', 'locked']
    ).includes(value.state) ||
    typeof value.updated_at !== 'string' ||
    !Number.isFinite(Date.parse(value.updated_at))
  ) {
    throw new BadGatewayException('托管平台返回的数据格式不正确，请重试。');
  }
  const text = (input: unknown) => (typeof input === 'string' ? input : '');
  const state =
    value.merged_at || value.state === 'merged'
      ? 'merged'
      : ['open', 'opened'].includes(value.state)
        ? 'open'
        : 'closed';
  return {
    number,
    title: value.title,
    // Build trusted web links ourselves; never open arbitrary URLs from API responses.
    url: `${remote.webUrl}/${github ? 'pull' : '-/merge_requests'}/${number}`,
    state,
    draft: Boolean(value.draft || (!github && value.work_in_progress)),
    author:
      text(github ? value.user?.login : value.author?.username) ||
      '已删除的用户',
    sourceBranch: text(
      github ? value.head?.label || value.head?.ref : value.source_branch,
    ),
    targetBranch: text(github ? value.base?.ref : value.target_branch),
    updatedAt: value.updated_at,
  };
}

@Injectable()
export class PullRequestsService {
  constructor(private readonly repositories: RepositoryService) {}

  private async withDeadline<T>(
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new GatewayTimeoutException(
          'PR/MR 查询超时，请检查 SSH 连接及本机网络后重试。',
        );
        controller.abort(error);
        reject(error);
      }, PULL_REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([work(controller.signal), timeout]);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Remote output and fetch errors may include credentials; never echo them.
      throw new BadGatewayException(
        '无法读取 PR/MR，请检查 SSH 连接、本机网络和托管平台地址后重试。',
      );
    } finally {
      clearTimeout(timer!);
    }
  }

  private async readRemotes(id: string, signal: AbortSignal) {
    const remotes = await this.repositories.getRemotes(id, signal);
    signal.throwIfAborted();
    return remotes.map(pullRequestRemote);
  }

  remotes(id: string): Promise<PullRequestRemote[]> {
    return this.withDeadline((signal) => this.readRemotes(id, signal));
  }

  list(id: string, input: unknown): Promise<PullRequestPage> {
    const query = validatePullRequestQuery(input);
    return this.withDeadline(async (signal) => {
      const remote = (await this.readRemotes(id, signal)).find(
        (item) => item.name === query.remote,
      );
      if (!remote)
        throw new NotFoundException('所选远端已不存在，请刷新远端列表。');
      if (remote.unavailableReason)
        throw new BadRequestException(remote.unavailableReason);
      if (remote.webUrl !== query.target)
        throw new ConflictException(
          '远端地址已变化，请刷新列表并重新配置认证。',
        );
      if (
        (remote.provider && remote.provider !== query.provider) ||
        (query.provider === 'github' && remote.host !== 'github.com')
      ) {
        throw new BadRequestException(
          '平台与远端不匹配；GitHub 目前仅支持 github.com。',
        );
      }
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'Alune',
      };
      if (query.provider === 'github') {
        headers['X-GitHub-Api-Version'] = '2022-11-28';
        if (query.token) headers.Authorization = `Bearer ${query.token}`;
      } else if (query.token) headers['PRIVATE-TOKEN'] = query.token;
      const response = await fetch(apiUrl(remote, query), {
        headers,
        signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        const limited =
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get('x-ratelimit-remaining') === '0' ||
              response.headers.has('retry-after')));
        const message = limited
          ? '托管平台请求次数已达上限，请稍后重试，或为公开仓库配置令牌。'
          : response.status === 401
            ? '认证失败，请检查访问令牌是否有效或已过期。'
            : response.status === 403
              ? '没有访问权限，请检查令牌的仓库权限及组织授权。'
              : response.status === 404
                ? '仓库不存在或没有访问权限；私有仓库需要有读取权限的令牌。'
                : query.provider === 'github'
                  ? 'GitHub 暂时不可用，请稍后重试。'
                  : '托管平台暂时不可用，或所选主机并非支持的 GitLab 实例，请稍后重试。';
        throw new HttpException(
          message,
          limited
            ? 429
            : [401, 403, 404].includes(response.status)
              ? response.status
              : 502,
        );
      }
      const data = await readJson(response);
      if (!Array.isArray(data) || data.length > PAGE_SIZE)
        throw new BadGatewayException('托管平台返回的数据格式不正确，请重试。');
      return {
        items: data.map((value) => normalizeItem(value, remote, query)),
        page: query.page,
        hasMore:
          /<[^>]+>;\s*rel="next"/.test(response.headers.get('link') || '') ||
          Boolean(response.headers.get('x-next-page')),
      };
    });
  }
}
