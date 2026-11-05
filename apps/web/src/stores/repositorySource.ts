import type { Repository } from '@alune/shared';

export { LOCAL_GROUP_ID, repositoryGroupId } from '@alune/shared';
export function repositorySourceLabel(repo: Pick<Repository, 'source'>): string {
  return repo.source === 'local' ? '本机' : 'SSH';
}
