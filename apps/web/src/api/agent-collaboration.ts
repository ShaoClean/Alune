import type { AgentClient } from '@alune/agent-client';
import { ProtocolError, type ResourceRef } from '@alune/protocol';
import type { aiApi } from './ai';
import type { repositoryApi, accessTokenApi, pullRequestCenterApi } from './index';

// The caller explicitly selects the local credential-owning Agent for the
// whole collaboration workspace. Never fall back to HTTP after dispatch.
export function createAgentCollaboration(
  client: AgentClient,
  resourceFor: (id: string) => ResourceRef,
) {
  const call = client.collaboration.bind(client);
  const write = async <T>(operationId: string, work: Promise<T>): Promise<T> => {
    try {
      return await work;
    } catch (error) {
      if (
        error instanceof ProtocolError &&
        error.outcome !== 'unknown' &&
        !['timeout', 'disconnected'].includes(error.kind)
      )
        throw error;
      const receipt = await client.getTask({ taskId: operationId }).catch(() => null);
      throw new Error(
        `${error instanceof Error ? error.message : '提交结果未知'}（操作 ${operationId}；${receipt?.task?.state === 'succeeded' ? '已执行成功，响应丢失' : '请刷新并在托管平台核对'}，请勿重复提交。）`,
        { cause: error },
      );
    }
  };
  const ai: typeof aiApi = {
    settings: () => client.getAiSettings(),
    saveProvider: (id, p, r) => client.saveAiProvider(id, p, r),
    saveCommit: (c, r) => client.saveCommitPreferences(c, r),
    models: (id, revision, signal) => call('ai.models', { input: { id, revision } }, { signal }),
    test: (id, input, signal) => call('ai.test', { input: { id, ...input } }, { signal }),
    generate: (id, revision, signal) =>
      call('ai.generate', { resource: resourceFor(id), input: { revision } }, { signal }),
    generatePullRequest: (id, input, signal) =>
      call('ai.generatePullRequest', { resource: resourceFor(id), input }, { signal }),
  };
  const accounts: typeof accessTokenApi = {
    list: () => client.listAccessTokens(),
    save: (id, input) => client.saveAccessToken(id, input),
    delete: (id, r) => client.deleteAccessToken(id, r),
  };
  const center: typeof pullRequestCenterApi = {
    sources: (cursor, signal) =>
      call('catalog.reviews.sources', { input: cursor ? { cursor } : {} }, { signal }),
    list: (input, signal) => call('catalog.reviews.list', { input }, { signal }),
    context: (id, input, signal) =>
      call('catalog.reviews.context', { resource: resourceFor(id), input }, { signal }),
  };
  const repository = {
    pullRequestRemotes: (id, signal) =>
      call('reviews.remotes', { resource: resourceFor(id) }, { signal }),
    pullRequests: (id, input, signal) =>
      call('reviews.list', { resource: resourceFor(id), input }, { signal }),
    pullRequestDetail: (id, input, signal) =>
      call('reviews.detail', { resource: resourceFor(id), input }, { signal }),
    pullRequestFiles: (id, input, signal) =>
      call('reviews.files', { resource: resourceFor(id), input }, { signal }),
    pullRequestDiscussions: (id, input, signal) =>
      call('reviews.discussions', { resource: resourceFor(id), input }, { signal }),
    pullRequestActions: (id, input, signal) =>
      call('reviews.actions', { resource: resourceFor(id), input }, { signal }),
    previewPullRequest: (id, input, signal) =>
      call('reviews.preview', { resource: resourceFor(id), input }, { signal }),
    applyAccessToken: (id, input) =>
      call('reviews.applyToken', { resource: resourceFor(id), input }),
    createPullRequest: (id, input) =>
      write(input.operationId, call('reviews.create', { resource: resourceFor(id), input })),
    mutatePullRequest: (id, input) =>
      write(input.operationId, call('reviews.mutate', { resource: resourceFor(id), input })),
  } satisfies Partial<typeof repositoryApi>;
  return { ai, accounts, center, repository };
}
