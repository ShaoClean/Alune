import { ProtocolError } from '@alune/protocol';
import type {
  AiSettings,
  PullRequestCreationQuery,
  SaveAiProvider,
  CommitGenerationPreferences,
  GeneratedCommit,
  TestAiProvider,
} from '@alune/protocol';

export const aiApi = {
  settings: (): Promise<AiSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 aiApi.settings。')),
  saveProvider: (
    _id: string | undefined,
    _provider: SaveAiProvider,
    _revision: string,
  ): Promise<AiSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 aiApi.saveProvider。')),
  saveCommit: (_commit: CommitGenerationPreferences, _revision: string): Promise<AiSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 aiApi.saveCommit。')),
  models: (_id: string, _revision: string, _signal: AbortSignal): Promise<AiSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 aiApi.models。')),
  test: (_id: string, _input: TestAiProvider, _signal: AbortSignal): Promise<{ message: string }> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 aiApi.test。')),
  generatePullRequest: (
    _repoId: string,
    _query: PullRequestCreationQuery & { configRevision: string; revision: string },
    _signal: AbortSignal,
  ): Promise<{ title: string; description: string; truncated: boolean }> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 aiApi.generatePullRequest。')),
  generate: (_repoId: string, _revision: string, _signal: AbortSignal): Promise<GeneratedCommit> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 aiApi.generate。')),
};

export function aiError(error: unknown): string {
  if (error instanceof ProtocolError) return error.message;
  return '无法完成 AI 操作，请检查本地服务或网络后重试。';
}
