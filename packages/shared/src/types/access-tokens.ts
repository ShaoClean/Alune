import type { PullRequestProvider } from './pull-requests';

export interface AccessTokenScope {
  provider: PullRequestProvider;
  origin: string;
}

export interface AccessToken {
  id: string;
  name: string;
  version: string;
  updatedAt: string;
  scope: AccessTokenScope | null;
  associations: { repositoryId: string; repositoryName: string; remote: string; target: string }[];
}

export interface AccessTokenSettings {
  revision: string;
  tokens: AccessToken[];
  secretStorage: { available: boolean; description: string };
}

export interface SaveAccessToken {
  name: string;
  value?: string;
  revision: string;
}

export interface PullRequestSelection {
  status: 'none' | 'applied' | 'target-changed' | 'token-deleted';
  tokenId: string | null;
  provider: PullRequestProvider | null;
  version: string;
}

export interface ApplyAccessToken {
  remote: string;
  target: string;
  provider: PullRequestProvider;
  tokenId: string | null;
  revision: string;
}
