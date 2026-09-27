import type { Repository } from '@alune/shared';

export const LOCAL_GROUP_ID = '@local';
export function repositoryGroupId(repo: Pick<Repository, 'source' | 'connectionId'>): string {
  return repo.source === 'local' ? LOCAL_GROUP_ID : repo.connectionId || '@unknown';
}
export function repositorySourceLabel(repo: Pick<Repository, 'source'>): string {
  return repo.source === 'local' ? '本机' : 'SSH';
}
