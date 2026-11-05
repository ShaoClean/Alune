import type { Repository } from './repository';

export const LOCAL_GROUP_ID = '@local';
export function repositoryGroupId(repo: Pick<Repository, 'source' | 'connectionId'>): string {
  return repo.source === 'local' ? LOCAL_GROUP_ID : repo.connectionId || '@unknown';
}
