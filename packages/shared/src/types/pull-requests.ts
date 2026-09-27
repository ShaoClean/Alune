export type PullRequestProvider = 'github' | 'gitlab';
export type PullRequestFilter = 'open' | 'all';

export interface PullRequestRemote {
  name: string;
  host: string;
  project: string;
  webUrl: string;
  provider: PullRequestProvider | null;
  unavailableReason?: string;
}

export interface PullRequestQuery {
  remote: string;
  // Bind credentials to the exact destination the user selected, even if Git config changes.
  target: string;
  provider: PullRequestProvider;
  state: PullRequestFilter;
  page: number;
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
