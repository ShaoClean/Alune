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
  ApplyAccessToken,
  PullRequestDetail,
  PullRequestDetailQuery,
  PullRequestResourceQuery,
  PullRequestDiscussionQuery,
  PullRequestDiscussion,
  PullRequestFile,
  PullRequestResourcePage,
} from '@alune/shared';
import { RepositoryService } from './repository.service';
import { pullRequestRemote } from './pull-request-remote';
import { AccessTokensService } from '../access-tokens/access-tokens.service';
import {
  count,
  normalizeDiscussion,
  normalizeFile,
  text,
} from './pull-request-content';

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

export function validatePullRequestDetailQuery(
  value: unknown,
): PullRequestDetailQuery {
  const input = value as PullRequestDetailQuery;
  validatePullRequestQuery({ ...input, state: 'open', page: 1 });
  if (!Number.isSafeInteger(input.number) || input.number < 1)
    throw new BadRequestException('请选择有效的 PR/MR 编号。');
  return input;
}

function validateResourceQuery(value: unknown): PullRequestResourceQuery {
  const input = value as PullRequestResourceQuery;
  validatePullRequestDetailQuery(input);
  validatePullRequestQuery({ ...input, state: 'open' });
  return input;
}

function resourceUrl(
  remote: PullRequestRemote,
  query: PullRequestDetailQuery,
  suffix = '',
  issues = false,
): URL {
  return new URL(
    query.provider === 'github'
      ? `https://api.github.com/repos/${remote.project.split('/').map(encodeURIComponent).join('/')}/${issues ? 'issues' : 'pulls'}/${query.number}${suffix}`
      : `https://${remote.host}/api/v4/projects/${encodeURIComponent(remote.project)}/merge_requests/${query.number}${suffix}`,
  );
}

function paged(url: URL, page: number): URL {
  url.searchParams.set('per_page', String(PAGE_SIZE));
  url.searchParams.set('page', String(page));
  return url;
}

function array(data: unknown): any[] {
  if (!Array.isArray(data) || data.length > PAGE_SIZE)
    throw new BadGatewayException('托管平台返回的数据格式不正确，请重试。');
  return data;
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
  constructor(
    private readonly repositories: RepositoryService,
    private readonly tokens: AccessTokensService,
  ) {}

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
    const parsed = remotes.map(pullRequestRemote);
    this.tokens.reconcile(id, parsed);
    return parsed.map((remote) => ({
      ...remote,
      selection: this.tokens.selection(id, remote),
    }));
  }

  remotes(id: string): Promise<PullRequestRemote[]> {
    return this.withDeadline((signal) => this.readRemotes(id, signal));
  }

  private async target(
    id: string,
    query: Pick<PullRequestQuery, 'remote' | 'target' | 'provider'>,
    signal: AbortSignal,
  ) {
    const remote = (await this.readRemotes(id, signal)).find(
      (item) => item.name === query.remote,
    );
    if (!remote)
      throw new NotFoundException('所选远端已不存在，请刷新远端列表。');
    if (remote.unavailableReason)
      throw new BadRequestException(remote.unavailableReason);
    if (remote.webUrl !== query.target)
      throw new ConflictException('远端地址已变化，请刷新列表并重新配置认证。');
    if (
      (remote.provider && remote.provider !== query.provider) ||
      (query.provider === 'github' && remote.host !== 'github.com')
    ) {
      throw new BadRequestException(
        '平台与远端不匹配；GitHub 目前仅支持 github.com。',
      );
    }
    return remote;
  }

  applyToken(id: string, input: unknown) {
    const body = input as ApplyAccessToken;
    const query = validatePullRequestQuery({ ...body, state: 'open', page: 1 });
    return this.withDeadline(async (signal) => {
      const remote = await this.target(id, query, signal);
      return this.tokens.apply(id, remote, body);
    });
  }

  private withRequest<T>(
    id: string,
    query: Pick<PullRequestQuery, 'remote' | 'target' | 'provider' | 'token'>,
    work: (
      remote: PullRequestRemote,
      request: (url: URL) => Promise<{ data: unknown; hasMore: boolean }>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.withDeadline(async (signal) => {
      const remote = await this.target(id, query, signal);
      // An explicitly supplied temporary value (including empty = anonymous) overrides the saved choice for this request only.
      const credential =
        query.token !== undefined
          ? { token: query.token, assertCurrent() {} }
          : this.tokens.credential(id, remote, query.provider);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'Alune',
      };
      if (query.provider === 'github') {
        headers['X-GitHub-Api-Version'] = '2022-11-28';
        if (credential.token)
          headers.Authorization = `Bearer ${credential.token}`;
      } else if (credential.token) headers['PRIVATE-TOKEN'] = credential.token;
      const request = async (url: URL) => {
        signal.throwIfAborted();
        credential.assertCurrent();
        const response = await fetch(url, {
          headers,
          signal,
          redirect: 'error',
        });
        try {
          credential.assertCurrent();
        } catch (error) {
          await response.body?.cancel();
          throw error;
        }
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
                  ? '仓库不存在、PR/MR 不存在或没有访问权限；私有仓库需要有读取权限的令牌。'
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
        credential.assertCurrent();
        return {
          data,
          hasMore:
            /<[^>]+>;\s*rel="next"/.test(response.headers.get('link') || '') ||
            Boolean(response.headers.get('x-next-page')),
        };
      };
      const result = await work(remote, request);
      credential.assertCurrent();
      return result;
    });
  }

  list(id: string, input: unknown): Promise<PullRequestPage> {
    const query = validatePullRequestQuery(input);
    return this.withRequest(id, query, async (remote, request) => {
      const { data, hasMore } = await request(apiUrl(remote, query));
      return {
        items: array(data).map((value) => normalizeItem(value, remote, query)),
        page: query.page,
        hasMore,
      };
    });
  }

  detail(id: string, input: unknown): Promise<PullRequestDetail> {
    const query = validatePullRequestDetailQuery(input);
    return this.withRequest(id, query, async (remote, request) => {
      const { data } = await request(resourceUrl(remote, query));
      const value = data as any;
      const item = normalizeItem(value, remote, {
        ...query,
        state: 'open',
        page: 1,
      });
      if (item.number !== query.number)
        throw new BadGatewayException(
          '托管平台返回了不同的 PR/MR，请刷新后重试。',
        );
      const github = query.provider === 'github';
      const changed = value.changes_count;
      const fileCount = github
        ? count(value.changed_files)
        : /^\d+$/.test(String(changed))
          ? count(Number(changed))
          : null;
      return {
        ...item,
        description: text(github ? value.body : value.description),
        fileCount,
        filesNotice:
          github && fileCount !== null && fileCount > 3000
            ? 'GitHub API 最多返回 3000 个变动文件；其余文件请在浏览器中查看。'
            : !github && typeof changed === 'string' && changed.endsWith('+')
              ? '文件数量超过 GitLab 的统计限制，平台可能省略部分文件或 Diff；请在浏览器中核对完整变动。'
              : undefined,
      };
    });
  }

  files(
    id: string,
    input: unknown,
  ): Promise<PullRequestResourcePage<PullRequestFile>> {
    const query = validateResourceQuery(input);
    return this.withRequest(id, query, async (remote, request) => {
      const github = query.provider === 'github';
      if (github && query.page > 100)
        return {
          items: [],
          page: query.page,
          hasMore: false,
          notice:
            '已达到 GitHub API 的 3000 个文件上限，请在浏览器中查看其余文件。',
        };
      let response: { data: unknown; hasMore: boolean };
      try {
        response = await request(
          paged(
            resourceUrl(remote, query, github ? '/files' : '/diffs'),
            query.page,
          ),
        );
      } catch (error) {
        // Older self-hosted GitLab versions expose changes but not the paged diffs API.
        if (
          github ||
          !(error instanceof HttpException) ||
          error.getStatus() !== 404
        )
          throw error;
        const { data } = await request(resourceUrl(remote, query, '/changes'));
        const legacy = data as any;
        if (!Array.isArray(legacy?.changes))
          throw new BadGatewayException(
            '此 GitLab 版本未提供可展示的 Diff，请在浏览器中查看。',
          );
        const offset = (query.page - 1) * PAGE_SIZE;
        return {
          items: legacy.changes
            .slice(offset, offset + PAGE_SIZE)
            .map((file: any) => normalizeFile(file, query.provider)),
          page: query.page,
          hasMore: offset + PAGE_SIZE < legacy.changes.length,
          notice: legacy.overflow
            ? 'GitLab 已截断变动文件或 Diff；以下仅为可用内容，请在浏览器中查看完整变动。'
            : undefined,
        };
      }
      return {
        items: array(response.data).map((file) =>
          normalizeFile(file, query.provider),
        ),
        page: query.page,
        hasMore: response.hasMore && (!github || query.page < 100),
        notice:
          github && query.page === 100
            ? '已达到 GitHub API 的 3000 个文件上限，请在浏览器中核对完整变动。'
            : undefined,
      };
    });
  }

  discussions(
    id: string,
    input: unknown,
  ): Promise<PullRequestResourcePage<PullRequestDiscussion>> {
    const query = validateResourceQuery(input) as PullRequestDiscussionQuery;
    if (
      !['comments', 'reviews', 'code'].includes(query.kind) ||
      (query.provider === 'gitlab' && query.kind !== 'comments')
    )
      throw new BadRequestException('请选择有效的讨论类型。');
    return this.withRequest(id, query, async (remote, request) => {
      const github = query.provider === 'github';
      const suffix = github
        ? query.kind === 'reviews'
          ? '/reviews'
          : '/comments'
        : '/discussions';
      const { data, hasMore } = await request(
        paged(
          resourceUrl(
            remote,
            query,
            suffix,
            github && query.kind === 'comments',
          ),
          query.page,
        ),
      );
      return {
        items: array(data).map((value) =>
          normalizeDiscussion(value, query.provider, query.kind),
        ),
        page: query.page,
        hasMore,
      };
    });
  }
}
