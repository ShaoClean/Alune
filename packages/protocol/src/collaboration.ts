import type { ResourceRef } from '@alune/domain';
import type { AiSettings, GeneratedCommit, TestAiProvider } from './legacy/ai';
import type {
  AccessTokenSettings,
  ApplyAccessToken,
  PullRequestRemote,
} from './legacy/access-tokens';
import type {
  PullRequestQuery,
  PullRequestPage,
  PullRequestDetail,
  PullRequestDetailQuery,
  PullRequestResourcePage,
  PullRequestFile,
  PullRequestResourceQuery,
  PullRequestDiscussionQuery,
  PullRequestDiscussion,
  PullRequestActions,
  PullRequestMutation,
  PullRequestMutationResult,
  PullRequestCreationQuery,
  PullRequestCreationPreview,
  CreatePullRequest,
  CreatedPullRequest,
} from './pull-requests';
import type {
  PullRequestCenterPage,
  PullRequestAccount,
  PullRequestCenterQuery,
  PullRequestSources,
} from './pull-request-center';
import { isRecord, ProtocolError } from './messages';
import { validateResource } from './repositories';

type Repo<T> = { resource: ResourceRef; input: T };
export interface CollaborationMethods {
  'ai.test': [{ input: TestAiProvider & { id: string } }, { message: string }];
  'ai.models': [{ input: { id: string; revision: string } }, AiSettings];
  'ai.generate': [Repo<{ revision: string }>, GeneratedCommit];
  'ai.generatePullRequest': [
    Repo<PullRequestCreationQuery & { revision: string; configRevision: string }>,
    { title: string; description: string; revision: string; truncated: boolean; modelId: string },
  ];
  'reviews.remotes': [{ resource: ResourceRef }, PullRequestRemote[]];
  'reviews.list': [Repo<PullRequestQuery>, PullRequestPage];
  'reviews.detail': [Repo<PullRequestDetailQuery>, PullRequestDetail];
  'reviews.files': [Repo<PullRequestResourceQuery>, PullRequestResourcePage<PullRequestFile>];
  'reviews.discussions': [
    Repo<PullRequestDiscussionQuery>,
    PullRequestResourcePage<PullRequestDiscussion>,
  ];
  'reviews.actions': [Repo<PullRequestDetailQuery>, PullRequestActions];
  'reviews.mutate': [Repo<PullRequestMutation>, PullRequestMutationResult];
  'reviews.applyToken': [Repo<ApplyAccessToken>, AccessTokenSettings];
  'reviews.preview': [Repo<PullRequestCreationQuery>, PullRequestCreationPreview];
  'reviews.create': [Repo<CreatePullRequest>, CreatedPullRequest];
  'catalog.reviews.sources': [{ input: { cursor?: string } }, PullRequestSources];
  'catalog.reviews.context': [
    Repo<PullRequestQuery>,
    { account: PullRequestAccount | null; identityNotice?: string },
  ];
  'catalog.reviews.list': [
    { input: { cursor?: string; discoveryId?: string; query?: PullRequestCenterQuery } },
    PullRequestCenterPage,
  ];
  'workspace.groups': [
    Record<string, never>,
    {
      agentId: string;
      groups: { connectionId: string | null; name: string; resources: ResourceRef[] }[];
    },
  ];
}

type Key = keyof CollaborationMethods;
const target = ['remote', 'target', 'provider', 'token', 'selectionVersion'];
const branch = [...target, 'sourceBranch', 'targetBranch'];
const detail = [...target, 'number'];
const page = [...target, 'state', 'page'];
const fields: Record<Key, string[] | null> = {
  'ai.models': ['id', 'revision'],
  'ai.test': ['id', 'revision', 'modelId'],
  'ai.generate': ['revision'],
  'ai.generatePullRequest': [...branch, 'configRevision', 'revision'],
  'reviews.remotes': null,
  'reviews.list': page,
  'reviews.detail': detail,
  'reviews.files': [...detail, 'page', 'revision'],
  'reviews.discussions': [...detail, 'page', 'kind', 'revision'],
  'reviews.actions': detail,
  'reviews.mutate': [...detail, 'operationId', 'revision', 'action', 'body', 'position', 'method'],
  'reviews.applyToken': ['remote', 'target', 'provider', 'tokenId', 'revision'],
  'reviews.preview': branch,
  'reviews.create': [
    ...branch,
    'operationId',
    'revision',
    'title',
    'description',
    'draft',
    'assignees',
    'reviewers',
    'labels',
  ],
  'catalog.reviews.sources': ['cursor'],
  'catalog.reviews.context': page,
  'catalog.reviews.list': ['cursor', 'query', 'discoveryId'],
  'workspace.groups': null,
};
export function validateCollaboration<K extends Key>(
  method: K,
  value: unknown,
): CollaborationMethods[K][0] {
  const invalid = (): never => {
    throw new ProtocolError('invalid-params', 'Invalid parameters for ' + method);
  };
  const resource =
    method.startsWith('reviews.') ||
    ['ai.generate', 'ai.generatePullRequest', 'catalog.reviews.context'].includes(method);
  const keys = fields[method];
  if (
    !isRecord(value) ||
    Object.keys(value).some((k) => !(resource && k === 'resource') && !(keys && k === 'input'))
  )
    return invalid();
  if (resource) validateResource(value.resource);
  if (keys) {
    const input = value.input;
    if (!isRecord(input) || Object.keys(input).some((k) => !keys.includes(k))) return invalid();
    const string = (k: string, max: number) =>
      typeof input[k] === 'string' &&
      (input[k] as string).length > 0 &&
      (input[k] as string).length <= max;
    if (
      method.startsWith('ai.') &&
      (!string('revision', 128) ||
        (['ai.models', 'ai.test'].includes(method) && !string('id', 80)) ||
        (method === 'ai.generatePullRequest' && !string('configRevision', 128)) ||
        (method === 'ai.test' && input.modelId != null && !string('modelId', 200)))
    )
      return invalid();
    if (
      ['reviews.create', 'reviews.mutate'].includes(method) &&
      (typeof input.operationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.operationId))
    )
      return invalid();
  }
  return value as CollaborationMethods[K][0];
}
