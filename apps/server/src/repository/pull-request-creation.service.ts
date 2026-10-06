import { createHash } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type {
  CreatePullRequest,
  CreatedPullRequest,
  PullRequestCreationPreview,
  PullRequestCreationQuery,
  PullRequestRemote,
} from '@alune/shared';
import { RepositoryService } from './repository.service';
import {
  normalizeItem,
  PullRequestsService,
  validatePullRequestQuery,
} from './pull-requests.service';
import { pullRequestRemote } from './pull-request-remote';
import { normalizeFile } from './pull-request-content';

const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value);
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const branch = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 1024 &&
  !/[\x00-\x20~^:?*\[\\]/.test(value) &&
  !value.startsWith('-') &&
  !value.includes('..');

export function validateCreation(input: unknown): PullRequestCreationQuery {
  const value = input as PullRequestCreationQuery;
  validatePullRequestQuery({ ...value, state: 'open', page: 1 });
  if (
    (value.sourceBranch !== undefined && !branch(value.sourceBranch)) ||
    (value.targetBranch !== undefined && !branch(value.targetBranch))
  )
    throw new BadRequestException('请选择有效的源分支和目标分支。');
  return value;
}

export function validateCreate(input: unknown): CreatePullRequest {
  const value = validateCreation(input) as CreatePullRequest;
  if (
    !branch(value.sourceBranch) ||
    !branch(value.targetBranch) ||
    value.sourceBranch === value.targetBranch ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 200 ||
    /[\r\n\0]/.test(value.title) ||
    typeof value.description !== 'string' ||
    value.description.length > 60000 ||
    value.description.includes('\0') ||
    typeof value.draft !== 'boolean' ||
    typeof value.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.revision) ||
    typeof value.operationId !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(value.operationId)
  )
    throw new BadRequestException(
      '请填写标题、有效的分支及描述，并重新预览改动后创建。',
    );
  for (const field of ['assignees', 'reviewers', 'labels'] as const) {
    const values = value[field];
    if (
      values !== undefined &&
      (!Array.isArray(values) ||
        values.length > 20 ||
        values.some(
          (v) =>
            typeof v !== 'string' ||
            !v ||
            v.length > 255 ||
            /[\0\r\n,]/.test(v) ||
            (value.provider === 'gitlab' &&
              field !== 'labels' &&
              !/^[1-9]\d*$/.test(v)),
        ))
    )
      throw new BadRequestException(
        '指派人、审阅者或标签无效，每项最多选择 20 个。',
      );
  }
  return value;
}

function projectUrl(remote: PullRequestRemote, github: boolean, suffix = '') {
  return new URL(
    github
      ? `https://api.github.com/repos/${remote.project.split('/').map(encodeURIComponent).join('/')}${suffix}`
      : `https://${remote.host}/api/v4/projects/${encodeURIComponent(remote.project)}${suffix}`,
  );
}

type RequestPlatform = Parameters<
  Parameters<PullRequestsService['withRequest']>[2]
>[1];

@Injectable()
export class PullRequestCreationService {
  private operations = new Map<
    string,
    {
      fingerprint: string;
      expires: number;
      result: Promise<CreatedPullRequest>;
    }
  >();
  constructor(
    private readonly repositories: RepositoryService,
    private readonly requests: PullRequestsService,
  ) {}

  async preview(
    id: string,
    input: unknown,
    metadata = true,
  ): Promise<PullRequestCreationPreview> {
    const query = validateCreation(input);
    return this.requests.withRequest(
      id,
      query,
      async (remote, request, _authenticated, signal) => {
        const github = query.provider === 'github';
        const local = await this.repositories.pullRequestBranch(
          id,
          query.sourceBranch,
          signal,
        );
        const project = (await request(projectUrl(remote, github))).data as any;
        const defaultBranch = project?.default_branch;
        if (!branch(defaultBranch))
          throw new BadGatewayException(
            '仓库尚无默认分支，请先在托管平台设置默认分支。',
          );
        const sourceBranch = local.name;
        const targetBranch = query.targetBranch || defaultBranch;
        const notices: string[] = [];
        const output: PullRequestCreationPreview = {
          sourceBranch,
          targetBranch,
          defaultBranch,
          branches: [defaultBranch],
          revision: '',
          pushRequired: false,
          commits: [],
          files: [],
          template: '',
          options: { assignees: [], reviewers: [], labels: [] },
        };
        const readBranch = async (name: string) => {
          const value = (
            await request(
              projectUrl(
                remote,
                github,
                `${github ? '' : '/repository'}/branches/${encodeURIComponent(name)}`,
              ),
            )
          ).data as any;
          const hash = github ? value?.commit?.sha : value?.commit?.id;
          if (!sha(hash))
            throw new BadGatewayException('托管平台未返回有效的分支版本。');
          return hash;
        };
        const configuredRemote = (
          await this.repositories.getRemotes(id, signal)
        ).find((item) => item.name === query.remote);
        if (
          configuredRemote &&
          pullRequestRemote({
            ...configuredRemote,
            fetchUrl: configuredRemote.pushUrl,
          }).webUrl !== remote.webUrl
        )
          output.pushBlockedReason =
            '此远端的推送地址与读取地址不同；请先在远程设置中选择指向同一仓库的地址。当前暂不支持跨仓库 PR/MR。';
        const base = await readBranch(targetBranch);
        let head = '';
        try {
          head = await readBranch(sourceBranch);
        } catch (error) {
          if (!(error instanceof HttpException) || error.getStatus() !== 404)
            throw error;
        }
        output.pushRequired = head !== local.sha;
        if (output.pushRequired)
          notices.push(
            '本地分支尚未完整推送到所选远端，请先推送并设置上游，再刷新预览。',
          );
        if (sourceBranch === targetBranch)
          notices.push('源分支与目标分支相同，请选择其他目标分支。');
        output.revision = digest([
          remote.webUrl,
          sourceBranch,
          targetBranch,
          local.sha,
          head,
          base,
        ]);
        if (head && sourceBranch !== targetBranch) {
          const existingUrl = projectUrl(
            remote,
            github,
            github ? '/pulls' : '/merge_requests',
          );
          existingUrl.search = new URLSearchParams(
            github
              ? {
                  state: 'open',
                  head: `${remote.project.split('/')[0]}:${sourceBranch}`,
                  base: targetBranch,
                  per_page: '1',
                }
              : {
                  state: 'opened',
                  scope: 'all',
                  source_branch: sourceBranch,
                  target_branch: targetBranch,
                  per_page: '1',
                },
          ).toString();
          const existing = (await request(existingUrl)).data;
          if (!Array.isArray(existing))
            throw new BadGatewayException('托管平台返回的 PR/MR 列表无效。');
          if (existing.length)
            output.existing = normalizeItem(existing[0], remote, {
              ...query,
              state: 'open',
              page: 1,
            });
          const compareUrl = projectUrl(
            remote,
            github,
            github ? `/compare/${base}...${head}` : '/repository/compare',
          );
          compareUrl.search = new URLSearchParams(
            github
              ? { per_page: '100', page: '1' }
              : { from: base, to: head, straight: 'false' },
          ).toString();
          const comparison = await request(compareUrl);
          const data = comparison.data as any;
          const files = github ? data?.files : data?.diffs;
          if (!Array.isArray(data?.commits) || !Array.isArray(files))
            throw new BadGatewayException(
              '平台未返回分支比较结果，请稍后重试。',
            );
          output.commits = data.commits.slice(0, 100).map((item: any) => {
            const hash = github ? item.sha : item.id;
            const message = github
              ? item.commit?.message
              : item.message || item.title;
            if (!sha(hash) || typeof message !== 'string')
              throw new BadGatewayException('平台返回的提交内容无效。');
            return { hash, message: message.slice(0, 12000) };
          });
          output.files = files
            .slice(0, 300)
            .map((file: any) => normalizeFile(file, query.provider));
          let patchBudget = 200000;
          for (const file of output.files) {
            if (!file.patch) continue;
            const originalLength = file.patch.length;
            file.patch =
              file.patch.slice(0, Math.min(20000, patchBudget)) || null;
            patchBudget -= file.patch?.length || 0;
            if ((file.patch?.length || 0) < originalLength)
              file.notice = '预览文本已截断，请在托管平台查看完整 Diff。';
          }
          if (output.files.some((file) => file.notice))
            notices.push('部分文件的文本 Diff 不完整，AI 仅使用可用内容。');
          if (
            comparison.hasMore ||
            data.total_commits > output.commits.length ||
            data.commits.length > 100
          )
            notices.push('提交预览最多显示 100 条，部分提交未展示。');
          if (
            files.length >= 300 ||
            data.compare_timeout ||
            data.overflow ||
            files.some((f: any) => f.too_large || f.collapsed)
          )
            notices.push(
              '平台可能省略部分文件或 Diff；请在托管平台核对完整改动。',
            );
          if (!output.commits.length)
            notices.push('源分支没有尚未包含在目标分支中的提交。');
        }
        if (metadata) {
          const branchesUrl = projectUrl(
            remote,
            github,
            github ? '/branches' : '/repository/branches',
          );
          branchesUrl.searchParams.set('per_page', '100');
          const listed = await request(branchesUrl);
          if (Array.isArray(listed.data))
            output.branches = [
              ...new Set([
                defaultBranch,
                targetBranch,
                ...listed.data.map((v: any) => v.name).filter(branch),
              ]),
            ];
          if (listed.hasMore)
            notices.push('分支列表仅显示前 100 项，可输入其他目标分支名称。');
          const template = await this.template(remote, github, base, request);
          output.template = template.content;
          output.templatePath = template.path;
          if (template.notice) notices.push(template.notice);
          output.options = await this.options(remote, github, request);
        }
        output.notice = notices.join(' ') || undefined;
        return output;
      },
      { responseBytes: 16 * 1024 * 1024 },
    );
  }

  private async template(
    remote: PullRequestRemote,
    github: boolean,
    ref: string,
    request: RequestPlatform,
  ) {
    const paths = github
      ? [
          '.github/pull_request_template.md',
          '.github/PULL_REQUEST_TEMPLATE.md',
          'pull_request_template.md',
          'PULL_REQUEST_TEMPLATE.md',
          'docs/pull_request_template.md',
          'docs/PULL_REQUEST_TEMPLATE.md',
        ]
      : [
          '.gitlab/merge_request_templates/Default.md',
          '.gitlab/merge_request_templates/default.md',
        ];
    let discovered = false;
    for (let index = 0; index <= paths.length; index++) {
      if (index === paths.length) {
        if (discovered) break;
        discovered = true;
        const directory = github
          ? '.github/PULL_REQUEST_TEMPLATE'
          : '.gitlab/merge_request_templates';
        const listUrl = projectUrl(
          remote,
          github,
          github ? `/contents/${directory}` : '/repository/tree',
        );
        listUrl.searchParams.set('ref', ref);
        if (!github) {
          listUrl.searchParams.set('path', directory);
          listUrl.searchParams.set('per_page', '100');
        }
        try {
          const list = (await request(listUrl)).data;
          const names = Array.isArray(list)
            ? list
                .filter(
                  (v: any) =>
                    (github ? v.type === 'file' : v.type === 'blob') &&
                    typeof v.name === 'string' &&
                    /^[^/\\]+\.md$/i.test(v.name),
                )
                .map((v: any) => `${directory}/${v.name}`)
                .sort()
            : [];
          if (!names.length) break;
          paths.push(names[0]);
        } catch (error) {
          if (
            error instanceof HttpException &&
            [403, 404].includes(error.getStatus())
          )
            break;
          throw error;
        }
      }
      const path = paths[index];
      const url = projectUrl(
        remote,
        github,
        github
          ? `/contents/${path.split('/').map(encodeURIComponent).join('/')}`
          : `/repository/files/${encodeURIComponent(path)}`,
      );
      url.searchParams.set('ref', ref);
      try {
        const value = (await request(url)).data as any;
        if (value?.encoding !== 'base64' || typeof value.content !== 'string')
          continue;
        const content = Buffer.from(value.content, 'base64').toString('utf8');
        return {
          path,
          content: content.slice(0, 12000),
          notice:
            content.length > 12000
              ? '仓库模板超过 12000 个字符，已截断。'
              : undefined,
        };
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        if (error.getStatus() === 404) continue;
        if (error.getStatus() === 403)
          return {
            content: '',
            notice: '当前令牌无法读取仓库模板，可手动填写描述。',
          };
        throw error;
      }
    }
    return { content: '' };
  }

  private async options(
    remote: PullRequestRemote,
    github: boolean,
    request: RequestPlatform,
  ): Promise<PullRequestCreationPreview['options']> {
    const output: PullRequestCreationPreview['options'] = {
      assignees: [],
      reviewers: [],
      labels: [],
    };
    const read = async (path: string, kind: 'users' | 'labels') => {
      const url = projectUrl(remote, github, path);
      url.searchParams.set('per_page', '100');
      try {
        const result = await request(url);
        if (!Array.isArray(result.data)) return [];
        if (result.hasMore)
          output.notice =
            '可选成员和标签仅显示前 100 项；其他成员可在创建后到托管平台设置。';
        return result.data.map((v: any) => ({
          value: String(kind === 'labels' ? v.name : github ? v.login : v.id),
          label:
            kind === 'labels'
              ? v.name
              : github
                ? v.login
                : `${v.name || v.username} (@${v.username})`,
        }));
      } catch (error) {
        if (
          !(error instanceof HttpException) ||
          ![403, 404].includes(error.getStatus())
        )
          throw error;
        output.notice =
          '部分可选项受平台或权限限制，可在创建后到托管平台补充。';
        return [];
      }
    };
    output.assignees = await read(
      github ? '/assignees' : '/members/all',
      'users',
    );
    output.reviewers = github
      ? await read('/collaborators', 'users')
      : output.assignees;
    output.labels = await read('/labels', 'labels');
    return output;
  }

  create(id: string, input: unknown): Promise<CreatedPullRequest> {
    const query = validateCreate(input);
    const key = `${id}:${query.operationId}`;
    const fingerprint = digest(query);
    for (const [k, v] of this.operations)
      if (v.expires < Date.now()) this.operations.delete(k);
    const previous = this.operations.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new ConflictException(
          '此提交编号已被使用，请重新确认表单后创建。',
        );
      return previous.result;
    }
    if (this.operations.size >= 200)
      throw new BadRequestException('创建操作过多，请稍后重试。');
    let dispatched = false;
    let receipt: CreatedPullRequest | undefined;
    const result = (async () => {
      const preview = await this.preview(id, query, false);
      if (preview.existing)
        throw new ConflictException(
          `此分支已存在开放中的 PR/MR #${preview.existing.number}，请刷新预览后打开已有请求。`,
        );
      if (preview.pushRequired && preview.pushBlockedReason)
        throw new ConflictException(preview.pushBlockedReason);
      if (preview.pushRequired)
        throw new ConflictException('分支尚未完整推送，请先推送并设置上游。');
      if (preview.revision !== query.revision)
        throw new ConflictException(
          '源分支或目标分支已变化，请刷新预览并重新确认后创建。',
        );
      if (!preview.commits.length)
        throw new BadRequestException('没有可创建 PR/MR 的提交。');
      return this.requests.withRequest(
        id,
        query,
        async (remote, request, authenticated) => {
          if (!authenticated)
            throw new ForbiddenException(
              '请先在访问设置中配置有写入权限的令牌。',
            );
          const github = query.provider === 'github';
          const title =
            !github &&
            query.draft &&
            !/^(draft:|wip:|\[draft\]|\(draft\))/i.test(query.title)
              ? `Draft: ${query.title.trim()}`
              : query.title.trim();
          const body = github
            ? {
                title,
                body: query.description,
                head: query.sourceBranch,
                base: query.targetBranch,
                draft: query.draft,
              }
            : {
                title,
                description: query.description,
                source_branch: query.sourceBranch,
                target_branch: query.targetBranch,
                assignee_ids: query.assignees?.map(Number),
                reviewer_ids: query.reviewers?.map(Number),
                labels: query.labels?.join(','),
              };
          let data: unknown;
          try {
            ({ data } = await request(
              projectUrl(remote, github, github ? '/pulls' : '/merge_requests'),
              {
                method: 'POST',
                body,
                onDispatch: () => {
                  dispatched = true;
                },
              },
            ));
          } catch (error) {
            if (error instanceof HttpException && error.getStatus() < 500) {
              dispatched = false;
              throw error;
            }
            throw new BadGatewayException(
              '未能确认创建结果。请刷新 PR/MR 列表核对是否已创建，确认前不要重复提交。',
            );
          }
          const item = normalizeItem(data, remote, {
            ...query,
            state: 'open',
            page: 1,
          });
          receipt = { item };
          let warning: string | undefined;
          if (github) {
            try {
              if (query.assignees?.length || query.labels?.length)
                await request(
                  projectUrl(remote, true, `/issues/${item.number}`),
                  {
                    method: 'PATCH',
                    body: { assignees: query.assignees, labels: query.labels },
                  },
                );
              if (query.reviewers?.length)
                await request(
                  projectUrl(
                    remote,
                    true,
                    `/pulls/${item.number}/requested_reviewers`,
                  ),
                  { method: 'POST', body: { reviewers: query.reviewers } },
                );
            } catch {
              warning =
                'PR 已创建，但部分指派人、审阅者或标签未设置成功，请在托管平台补充。';
            }
          }
          return { item, warning };
        },
      );
    })().catch((error) => {
      if (receipt)
        return {
          ...receipt,
          warning: 'PR/MR 已创建，但部分可选项未确认成功，请在托管平台核对。',
        };
      if (!dispatched) this.operations.delete(key);
      if (
        dispatched &&
        (!(error instanceof HttpException) || error.getStatus() >= 500)
      )
        throw new BadGatewayException(
          '未能确认创建结果。请刷新 PR/MR 列表核对是否已创建，确认前不要重复提交。',
        );
      throw error;
    });
    this.operations.set(key, {
      fingerprint,
      result,
      expires: Date.now() + 30 * 60_000,
    });
    return result;
  }
}
