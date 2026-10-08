import type { PullRequestItem, PullRequestProvider, PullRequestRemote } from './pull-requests';

export interface PullRequestAccount {
  key: string;
  username: string;
  host: string;
}
export interface PullRequestSource {
  id: string;
  repositoryId: string;
  repositoryName: string;
  location: string;
  remote: PullRequestRemote | null;
  provider: PullRequestProvider | null;
  projectKey: string | null;
  account: PullRequestAccount | null;
  identityNotice?: string;
  status: 'ready' | 'success' | 'configuration' | 'unsupported' | 'error';
  message?: string;
}
export interface PullRequestSources {
  discoveryId: string;
  sources: PullRequestSource[];
  repositoryCount: number;
  discoveredCount: number;
  complete: boolean;
  cursor: string | null;
}
export interface PullRequestCenterQuery {
  view: 'all' | 'created' | 'review';
  state: 'open' | 'merged' | 'closed' | 'all';
  search: string;
  projects: string[];
  provider: PullRequestProvider | '';
  account: string;
}
export interface PullRequestCenterItem extends PullRequestItem {
  key: string;
  projectKey: string;
  sourceId: string;
  sourceIds: string[];
  provider: PullRequestProvider;
  project: string;
  host: string;
}
export interface PullRequestCenterPage {
  items: PullRequestCenterItem[];
  sources: PullRequestSource[];
  nextCursor: string | null;
  scanning: boolean;
  completedSources: number;
  totalSources: number;
  updatedAt: string;
}
