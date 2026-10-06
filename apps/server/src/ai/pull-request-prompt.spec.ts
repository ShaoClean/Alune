import { AiService } from './ai.service';
import { complete } from './ai-provider';
import { parsePullRequest, pullRequestPrompt } from './pull-request-prompt';
import type { PullRequestCreationPreview } from '@alune/shared';
jest.mock('./ai-provider', () => ({ complete: jest.fn() }));
const snapshot = (): PullRequestCreationPreview => ({
  sourceBranch: 'feature',
  targetBranch: 'main',
  defaultBranch: 'main',
  branches: ['main'],
  revision: 'a'.repeat(64),
  pushRequired: false,
  commits: [{ hash: 'b'.repeat(40), message: 'feat: 添加入口' }],
  files: [
    {
      path: 'entry.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
      patch: '+entry();',
    },
  ],
  template: '## 改动\n\n## 测试',
  templatePath: '.github/pull_request_template.md',
  options: { assignees: [], reviewers: [], labels: [] },
});
describe('PR/MR AI drafting', () => {
  it('bounds the entire escaped prompt and explicitly marks truncation', () => {
    const preview = snapshot();
    preview.files = Array.from({ length: 300 }, (_, i) => ({
      ...preview.files[0],
      path: `${i}.ts`,
      patch: '\\"中文'.repeat(5000),
    }));
    preview.template = '\\'.repeat(12000);
    preview.commits = Array.from({ length: 100 }, () => ({
      ...preview.commits[0],
      message: '中'.repeat(20000),
    }));
    const prompt = pullRequestPrompt(preview);
    expect(prompt.truncated).toBe(true);
    expect(JSON.stringify(prompt).length).toBeLessThanOrEqual(60000);
    expect(prompt.files.length).toBeGreaterThan(0);
    expect(prompt.template.length).toBeGreaterThan(0);
  });
  it('rejects malformed titles and non-JSON output', () => {
    for (const value of [
      'not json',
      '{"title":"","description":""}',
      '{"title":"a\\nb","description":""}',
    ])
      expect(() => parsePullRequest(value)).toThrow('格式无效');
    expect(
      parsePullRequest(
        '```json\n{"title":"feat: 入口","description":"## 改动"}\n```',
      ),
    ).toEqual({ title: 'feat: 入口', description: '## 改动' });
  });
  const setup = () => {
    const preview = jest.fn().mockResolvedValue(snapshot());
    const settings = {
      assertRevision: jest.fn(),
      read: () => ({
        providers: [
          {
            id: 'provider',
            enabled: true,
            models: [{ id: 'model', enabled: true }],
          },
        ],
        commit: { providerId: 'provider', modelId: 'model', language: 'zh-CN' },
      }),
      key: () => 'ai-secret',
    };
    const service = new AiService(
      settings as any,
      {} as any,
      {} as any,
      undefined,
      { preview } as any,
    );
    const input = {
      remote: 'origin',
      target: 'https://github.com/team/repo',
      provider: 'github' as const,
      token: 'hosting-secret',
      configRevision: 'config',
      revision: snapshot().revision,
    };
    jest
      .mocked(complete)
      .mockReset()
      .mockResolvedValue(
        '{"title":"feat: 入口","description":"## 改动\\n添加入口"}',
      );
    return { service, preview, settings, input };
  };
  it('sends only scoped repository data, includes the template and does not publish', async () => {
    const { service, input, preview } = setup();
    expect(
      (
        await service.generatePullRequest(
          'repo',
          input,
          new AbortController().signal,
        )
      ).title,
    ).toBe('feat: 入口');
    const [, , , system, payload] = jest.mocked(complete).mock.calls[0];
    expect(system).toContain('untrusted data');
    expect(payload).toContain('## 测试');
    expect(payload).not.toMatch(/hosting-secret|ai-secret|token/);
    expect(preview).toHaveBeenCalledTimes(2);
  });
  it('rejects outdated or unpublished inputs before sending any AI request', async () => {
    const { service, preview, input } = setup();
    preview.mockResolvedValue({ ...snapshot(), pushRequired: true });
    await expect(
      service.generatePullRequest('repo', input, new AbortController().signal),
    ).rejects.toThrow('尚未推送');
    expect(complete).not.toHaveBeenCalled();
  });
  it('does not apply a generated result after branches or settings changed', async () => {
    const { service, preview, input } = setup();
    preview
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce({ ...snapshot(), revision: 'c'.repeat(64) });
    await expect(
      service.generatePullRequest('repo', input, new AbortController().signal),
    ).rejects.toThrow('生成期间分支已变化');
  });
});
