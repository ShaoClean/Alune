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
}

export type PullRequestDiscussionKind = 'comments' | 'reviews' | 'code';

export interface PullRequestDiscussionQuery extends PullRequestResourceQuery {
  kind: PullRequestDiscussionKind;
}

export interface PullRequestDetail extends PullRequestItem {
  description: string;
  fileCount: number | null;
  filesNotice?: string;
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
  outdated: boolean;
  patch?: string;
  notice?: string;
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
