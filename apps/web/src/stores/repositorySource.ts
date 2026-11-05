import type { Repository } from '@alune/domain';

export { LOCAL_GROUP_ID, repositoryGroupId } from '@alune/domain';
export function repositorySourceLabel(repo: Pick<Repository, 'source'>): string {
  return repo.source === 'local' ? '本机' : 'SSH';
}
