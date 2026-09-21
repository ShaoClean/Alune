import axios from 'axios';
import type {
  AiSettings,
  SaveAiProvider,
  CommitGenerationPreferences,
  GeneratedCommit,
  TestAiProvider,
} from '@alune/shared';

const api = axios.create({ baseURL: '/api/ai', timeout: 65_000 });
export const aiApi = {
  settings: (): Promise<AiSettings> => api.get('/settings').then((r) => r.data),
  saveProvider: (
    id: string | undefined,
    provider: SaveAiProvider,
    revision: string,
  ): Promise<AiSettings> =>
    (id
      ? api.put(`/providers/${encodeURIComponent(id)}`, { provider, revision })
      : api.post('/providers', { provider, revision })
    ).then((r) => r.data),
  saveCommit: (commit: CommitGenerationPreferences, revision: string): Promise<AiSettings> =>
    api.put('/commit-settings', { commit, revision }).then((r) => r.data),
  models: (id: string, revision: string, signal: AbortSignal): Promise<AiSettings> =>
    api
      .post(`/providers/${encodeURIComponent(id)}/models`, { revision }, { signal })
      .then((r) => r.data),
  test: (id: string, input: TestAiProvider, signal: AbortSignal): Promise<{ message: string }> =>
    api.post(`/providers/${encodeURIComponent(id)}/test`, input, { signal }).then((r) => r.data),
  generate: (repoId: string, revision: string, signal: AbortSignal): Promise<GeneratedCommit> =>
    api
      .post(`/repositories/${encodeURIComponent(repoId)}/generate`, { revision }, { signal })
      .then((r) => r.data),
};

export function aiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') return 'AI 请求超时，草稿已保留，请重试。';
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
  }
  return '无法完成 AI 操作，请检查本地服务或网络后重试。';
}
