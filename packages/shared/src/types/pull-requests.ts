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
import type { PullRequestSelection } from './access-tokens';
