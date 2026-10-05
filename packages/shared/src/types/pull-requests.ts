export type PullRequestProvider = 'github' | 'gitlab';
export type PullRequestFilter = 'open' | 'all';

export interface PullRequestRemote {
  name: string;
  host: string;
  project: string;
  webUrl: string;
  provider: PullRequestProvider | null;
  unavailableReason?: string;
  selection?: PullRequestSelection;
}

export interface PullRequestQuery {
  remote: string;
  // Bind credentials to the exact destination the user selected, even if Git config changes.
  target: string;
  provider: PullRequestProvider;
  state: PullRequestFilter;
  page: number;
  // Omitted: resolve this remote's saved association; supplied: use only this temporary value.
  // An empty value explicitly requests anonymous access without altering the saved association.
  token?: string;
}

export interface PullRequestItem {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  updatedAt: string;
}

export interface PullRequestPage {
  items: PullRequestItem[];
  page: number;
  hasMore: boolean;
}

export interface PullRequestDetailQuery extends Omit<PullRequestQuery, 'state' | 'page'> {
  number: number;
}

export interface PullRequestResourceQuery extends PullRequestDetailQuery {
  page: number;
  revision?: string;
}

export type PullRequestDiscussionKind = 'comments' | 'reviews' | 'code';

export interface PullRequestDiscussionQuery extends PullRequestResourceQuery {
  kind: PullRequestDiscussionKind;
}

export interface PullRequestDetail extends PullRequestItem {
  description: string;
  fileCount: number | null;
  filesNotice?: string;
  revision?: string;
}

export interface PullRequestFile {
  path: string;
  previousPath?: string;
  status: 'added' | 'deleted' | 'renamed' | 'modified';
  additions: number | null;
  deletions: number | null;
  patch: string | null;
  notice?: string;
}

export interface PullRequestCodeContext {
  path: string;
  oldPath?: string;
  oldLine?: number;
  newLine?: number;
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  outdated: boolean;
  patch?: string;
  notice?: string;
}

export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

export interface PullRequestActions {
  revision: string;
  state: PullRequestItem['state'];
  targetBranch: string;
  comment: { allowed: boolean; reason?: string };
  close: { allowed: boolean; reason?: string };
  merge: { allowed: boolean; reason?: string };
  mergeMethods: { value: PullRequestMergeMethod; label: string }[];
}

export interface PullRequestCommentPosition {
  path: string;
  side: 'LEFT' | 'RIGHT';
  startLine: number;
  endLine: number;
  filePage: number;
}

export interface PullRequestMutation extends PullRequestDetailQuery {
  // Reuse this ID when retrying the same submission.
  operationId: string;
  revision: string;
  action: 'comment' | 'merge' | 'close';
  body?: string;
  position?: PullRequestCommentPosition;
  method?: PullRequestMergeMethod;
}

export interface PullRequestMutationResult {
  state?: PullRequestItem['state'];
  discussion?: PullRequestDiscussion;
}

export interface PullRequestComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  replyTo?: string;
  reviewState?: string;
  system: boolean;
  context?: PullRequestCodeContext;
}

export interface PullRequestDiscussion {
  id: string;
  resolved?: boolean;
  comments: PullRequestComment[];
}

export interface PullRequestResourcePage<T> {
  items: T[];
  page: number;
  hasMore: boolean;
  notice?: string;
}
import type { PullRequestSelection } from './access-tokens';

export interface PullRequestCreationQuery extends Omit<PullRequestQuery, 'state' | 'page'> {
  sourceBranch?: string;
  targetBranch?: string;
}

export interface PullRequestCreationPreview {
  sourceBranch: string;
  targetBranch: string;
  defaultBranch: string;
  branches: string[];
  revision: string;
  pushRequired: boolean;
  pushBlockedReason?: string;
  notice?: string;
  commits: { hash: string; message: string }[];
  files: PullRequestFile[];
  existing?: PullRequestItem;
  template: string;
  templatePath?: string;
  options: {
    assignees: { value: string; label: string }[];
    reviewers: { value: string; label: string }[];
    labels: { value: string; label: string }[];
    notice?: string;
  };
}

export interface CreatePullRequest extends PullRequestCreationQuery {
  sourceBranch: string;
  targetBranch: string;
  revision: string;
  operationId: string;
  title: string;
  description: string;
  draft: boolean;
  assignees?: string[];
  reviewers?: string[];
  labels?: string[];
}

export interface CreatedPullRequest {
  item: PullRequestItem;
  warning?: string;
}
