import { LOCAL_GROUP_ID, repositoryGroupId } from '@alune/domain';
import type { RepositoryResource } from '@alune/protocol';

// Group registrations by their actual owner. Tab order, editors and in-flight
// drafts belong to the client; no UI buffers are accepted by this interface.
export function workspaceGroups(
  agentId: string,
  hosts: { id: string; name: string }[],
  repositories: RepositoryResource[],
) {
  const groups = new Map<
    string,
    { connectionId: string | null; name: string; resources: RepositoryResource['resource'][] }
  >();
  groups.set(LOCAL_GROUP_ID, { connectionId: null, name: '本机', resources: [] });
  for (const host of hosts)
    groups.set(host.id, { connectionId: host.id, name: host.name, resources: [] });
  for (const repo of repositories) {
    const id = repositoryGroupId(repo);
    if (!groups.has(id))
      groups.set(id, { connectionId: repo.connectionId ?? null, name: id, resources: [] });
    groups.get(id)!.resources.push(repo.resource);
  }
  return { agentId, groups: [...groups.values()] };
}
