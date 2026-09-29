import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  PullRequestActions,
  PullRequestMutationResult,
} from '@alune/shared';
import { createHash } from 'node:crypto';
import {
  assertRevision,
  codeCommentPayload,
  requestActions,
  requestRevision,
  validateMutation,
} from './pull-request-actions';
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
  private readonly operations = new Map<
    string,
    {
      fingerprint: string;
      expires: number;
      result: Promise<PullRequestMutationResult>;
    }
  >();
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
      request: (
        url: URL,
        options?: {
          method: 'POST' | 'PUT' | 'PATCH';
          body: unknown;
          onDispatch?: () => void;
        },
      ) => Promise<{ data: unknown; hasMore: boolean }>,
      authenticated: boolean,
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
      let writeDispatched = false;
      const request = async (
        url: URL,
        options?: {
          method: 'POST' | 'PUT' | 'PATCH';
          body: unknown;
          onDispatch?: () => void;
        },
      ) => {
        if (options) {
          if (!credential.token)
            throw new ForbiddenException('请配置有写入权限的访问令牌。');
          // Resolve the local Git remote again immediately before sending a write.
          await this.target(id, query, signal);
        }
        signal.throwIfAborted();
        credential.assertCurrent();
        if (options) writeDispatched = true;
        options?.onDispatch?.();
        const response = await fetch(url, {
          ...(options
            ? { method: options.method, body: JSON.stringify(options.body) }
            : {}),
          headers: options
            ? { ...headers, 'Content-Type': 'application/json' }
            : headers,
          signal,
          redirect: 'error',
        });
        try {
          if (!options) credential.assertCurrent();
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
          const message =
            options && [400, 405, 406, 409, 422].includes(response.status)
              ? response.status === 409
                ? '托管平台检测到代码版本或状态冲突，请刷新后重新确认。'
                : url.pathname.endsWith('/merge')
                  ? '平台拒绝合并：冲突、所需检查、审批或分支保护条件未满足，请刷新后核对。'
                  : '平台拒绝此操作：评论内容或代码定位无效，或 PR/MR 状态已变化。请刷新详情后重试。'
              : limited
                ? '托管平台请求次数已达上限，请稍后重试，或为公开仓库配置令牌。'
                : response.status === 401
                  ? '认证失败，请检查访问令牌是否有效或已过期。'
                  : response.status === 403
                    ? options
                      ? '没有写入权限，请检查令牌的写权限、仓库角色及组织授权。'
                      : '没有访问权限，请检查令牌的仓库权限及组织授权。'
                    : response.status === 404
                      ? '仓库不存在、PR/MR 不存在或没有访问权限；私有仓库需要有读取权限的令牌。'
                      : query.provider === 'github'
                        ? 'GitHub 暂时不可用，请稍后重试。'
                        : '托管平台暂时不可用，或所选主机并非支持的 GitLab 实例，请稍后重试。';
          throw new HttpException(
            message,
            limited
              ? 429
              : [
                    401,
                    403,
                    404,
                    ...(options ? [400, 405, 406, 409, 422] : []),
                  ].includes(response.status)
                ? response.status
                : 502,
          );
        }
        const data = await readJson(response);
        if (!options) credential.assertCurrent();
        return {
          data,
          hasMore:
            /<[^>]+>;\s*rel="next"/.test(response.headers.get('link') || '') ||
            Boolean(response.headers.get('x-next-page')),
        };
      };
      const result = await work(remote, request, Boolean(credential.token));
      // A credential change cannot undo a dispatched write. Preserve its receipt
      // so an acknowledged success is never presented as a retryable failure.
      if (!writeDispatched) credential.assertCurrent();
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
        revision: requestRevision(value, query.provider),
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
    if (
      query.revision !== undefined &&
      (typeof query.revision !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(query.revision))
    )
      throw new BadRequestException('Diff 版本无效，请刷新详情。');
    const read = () =>
      this.withRequest(id, query, async (remote, request) => {
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
          const { data } = await request(
            resourceUrl(remote, query, '/changes'),
          );
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
    if (!query.revision) return read();
    return this.checkedFiles(id, query, read);
  }

  private async checkedFiles(
    id: string,
    query: PullRequestResourceQuery,
    read: () => Promise<PullRequestResourcePage<PullRequestFile>>,
  ) {
    const check = async () => {
      const detail = await this.detail(id, query);
      if (detail.revision !== query.revision)
        throw new ConflictException(
          'Diff 已变化，请刷新详情后重新选择代码范围。',
        );
    };
    await check();
    const files = await read();
    await check();
    return files;
  }

  actions(id: string, input: unknown): Promise<PullRequestActions> {
    const query = validatePullRequestDetailQuery(input);
    return this.withRequest(
      id,
      query,
      async (remote, request, authenticated) => {
        const { data } = await request(resourceUrl(remote, query));
        this.assertDetail(data, query);
        const projectUrl = this.projectUrl(remote, query.provider);
        const project = authenticated ? (await request(projectUrl)).data : {};
        const user = authenticated
          ? (
              await request(
                new URL(
                  query.provider === 'github'
                    ? 'https://api.github.com/user'
                    : `https://${remote.host}/api/v4/user`,
                ),
              )
            ).data
          : {};
        return requestActions(
          data,
          project,
          user,
          query.provider,
          authenticated,
        );
      },
    );
  }

  private projectUrl(
    remote: PullRequestRemote,
    provider: PullRequestQuery['provider'],
  ) {
    return new URL(
      provider === 'github'
        ? `https://api.github.com/repos/${remote.project.split('/').map(encodeURIComponent).join('/')}`
        : `https://${remote.host}/api/v4/projects/${encodeURIComponent(remote.project)}`,
    );
  }

  private assertDetail(value: any, query: PullRequestDetailQuery) {
    if (
      (query.provider === 'github' ? value?.number : value?.iid) !==
        query.number ||
      !['open', 'opened', 'closed', 'merged', 'locked'].includes(value?.state)
    )
      throw new BadGatewayException(
        '托管平台返回了不同或无效的 PR/MR，请刷新后重试。',
      );
  }

  mutate(id: string, input: unknown): Promise<PullRequestMutationResult> {
    validatePullRequestDetailQuery(input);
    const query = validateMutation(input);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([id, query]))
      .digest('hex');
    // Keep acknowledged and uncertain writes so a retried HTTP request cannot post twice.
    for (const [key, entry] of this.operations)
      if (entry.expires < Date.now()) this.operations.delete(key);
    const previous = this.operations.get(query.operationId);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new ConflictException('操作编号已用于其他内容，请重新提交。');
      return previous.result;
    }
    if (this.operations.size >= 2000)
      throw new HttpException('待确认的操作过多，请稍后重试。', 429);
    let dispatched = false;
    const result = this.withRequest<PullRequestMutationResult>(
      id,
      query,
      async (remote, request, authenticated) => {
        if (!authenticated)
          throw new ForbiddenException('请配置有写入权限的访问令牌。');
        const current = async () => {
          const { data } = await request(resourceUrl(remote, query));
          this.assertDetail(data, query);
          assertRevision(data, query);
          return data as any;
        };
        let value = await current();
        const project = (await request(this.projectUrl(remote, query.provider)))
          .data;
        const user = (
          await request(
            new URL(
              query.provider === 'github'
                ? 'https://api.github.com/user'
                : `https://${remote.host}/api/v4/user`,
            ),
          )
        ).data;
        let actions = requestActions(
          value,
          project,
          user,
          query.provider,
          authenticated,
        );
        if (!actions[query.action].allowed)
          throw new ConflictException(actions[query.action].reason);
        const github = query.provider === 'github';
        let payload: unknown;
        if (query.action === 'comment' && query.position) {
          const files = await this.files(id, {
            ...query,
            page: query.position.filePage,
          });
          const file = files.items.find(
            (item) => item.path === query.position!.path,
          );
          if (!file)
            throw new ConflictException(
              '文件已不在当前 Diff 中，请刷新后重新选择。',
            );
          payload = codeCommentPayload(query, value, file);
        } else payload = { body: query.body };
        // Refresh state after all preflight reads. Merge additionally carries the head SHA
        // as an atomic platform-side guard; close APIs have no conditional revision field.
        value = await current();
        actions = requestActions(
          value,
          project,
          user,
          query.provider,
          authenticated,
        );
        if (!actions[query.action].allowed)
          throw new ConflictException(actions[query.action].reason);
        let url: URL;
        let method: 'POST' | 'PUT' | 'PATCH';
        if (query.action === 'comment') {
          url = resourceUrl(
            remote,
            query,
            github ? '/comments' : query.position ? '/discussions' : '/notes',
            github && !query.position,
          );
          method = 'POST';
        } else if (query.action === 'merge') {
          if (!actions.mergeMethods.some((item) => item.value === query.method))
            throw new ConflictException(
              '项目允许的合并方式已变化，请刷新后重新选择。',
            );
          url = resourceUrl(remote, query, '/merge');
          method = 'PUT';
          payload = github
            ? { sha: value.head.sha, merge_method: query.method }
            : {
                sha: value.diff_refs.head_sha,
                squash: query.method === 'squash',
              };
        } else {
          url = resourceUrl(remote, query);
          method = github ? 'PATCH' : 'PUT';
          payload = github ? { state: 'closed' } : { state_event: 'close' };
        }
        const { data } = await request(url, {
          method,
          body: payload,
          onDispatch: () => {
            dispatched = true;
          },
        });
        const response = data as any;
        if (query.action === 'comment')
          return {
            discussion: normalizeDiscussion(
              !github && !query.position
                ? { id: String(response.id), notes: [response] }
                : response,
              query.provider,
              query.position ? 'code' : 'comments',
            ),
          };
        if (
          query.action === 'merge' &&
          (github ? response?.merged !== true : response?.state !== 'merged')
        )
          throw new ConflictException(
            '平台未确认合并成功，请刷新状态并核对合并条件。',
          );
        if (query.action === 'close' && response?.state !== 'closed')
          throw new ConflictException('平台未确认关闭成功，请刷新状态。');
        return { state: query.action === 'merge' ? 'merged' : 'closed' };
      },
    ).catch((error: unknown) => {
      const status = error instanceof HttpException ? error.getStatus() : 502;
      if (!dispatched || status < 500)
        this.operations.delete(query.operationId);
      if (dispatched && status >= 500)
        throw new BadGatewayException(
          '提交结果尚未确认，请先刷新并在托管平台核对；为避免重复提交，同一操作不会再次发送，草稿已保留。',
        );
      throw error;
    });
    this.operations.set(query.operationId, {
      fingerprint,
      expires: Date.now() + 24 * 60 * 60 * 1000,
      result,
    });
    return result;
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
