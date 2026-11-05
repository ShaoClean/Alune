import type { ResourceRef, WorktreeKind } from '@alune/domain';
import type { RepositoryResource } from '@alune/protocol';
import { ProtocolError } from '@alune/protocol';
import { randomUUID } from 'node:crypto';
import type { SqlDatabase } from '../../ports/sql';
import { worktreePathKey } from '../git/worktrees';

export class RepositoryCatalog {
  constructor(
    private readonly db: SqlDatabase,
    readonly agentId: string,
  ) {}
  private fromRow(row: any): RepositoryResource {
    return {
      id: row.id,
      resource: { agentId: this.agentId, resourceId: row.id },
      source: row.source,
      ...(row.connection_id ? { connectionId: row.connection_id } : {}),
      name: row.name,
      path: row.path,
      pinned: !!row.pinned,
      ...(row.worktree_kind ? { worktreeKind: row.worktree_kind as WorktreeKind } : {}),
    };
  }
  list(): RepositoryResource[] {
    return this.db
      .prepare('SELECT * FROM repositories ORDER BY pinned DESC, created_at, id')
      .all()
      .map((r) => this.fromRow(r));
  }
  get(resource: ResourceRef, local = true): RepositoryResource {
    if (resource.agentId !== this.agentId)
      throw new ProtocolError('not-found', 'Repository belongs to another Agent');
    const row = this.db.prepare('SELECT * FROM repositories WHERE id = ?').get(resource.resourceId);
    if (!row) throw new ProtocolError('not-found', 'Repository is not registered');
    const repo = this.fromRow(row);
    if (local && repo.source !== 'local')
      throw new ProtocolError('unavailable', 'This repository requires the SSH Agent route');
    return repo;
  }
  register(path: string, name: string, kind: WorktreeKind): RepositoryResource {
    const key = (p: string) =>
      process.platform === 'win32' ? worktreePathKey(p).toLowerCase() : worktreePathKey(p);
    return this.db
      .transaction(() => {
        const existing = this.list().find((r) => r.source === 'local' && key(r.path) === key(path));
        if (existing) return existing;
        const id = randomUUID();
        this.db
          .prepare(
            "INSERT INTO repositories (id, source, name, path, worktree_kind, created_at) VALUES (?, 'local', ?, ?, ?, ?)",
          )
          .run(id, name, path, kind, new Date().toISOString());
        return this.get({ agentId: this.agentId, resourceId: id });
      })
      .immediate();
  }
  bindHost(hostId: string, repo: RepositoryResource, windows: boolean) {
    // The mapping and alias row commit together. Changing a path's resource ID
    // never transfers credential bindings to the replacement registration.
    const key = JSON.stringify([hostId, repo.resource.agentId, repo.id]);
    const pathKey = (p: string) => (windows ? p.replaceAll('\\', '/').toLowerCase() : p);
    return this.db
      .transaction(() => {
        const existing = this.db
          .prepare("SELECT kind FROM resource_ids WHERE kind LIKE 'ssh-binding:%' AND local_key=?")
          .get(key) as { kind: string } | undefined;
        const priorId = existing?.kind.slice('ssh-binding:'.length);
        const row =
          priorId && this.db.prepare('SELECT * FROM repositories WHERE id=?').get(priorId);
        if (row) return this.fromRow(row);
        const legacy = this.list().find(
          (r) =>
            r.source === 'ssh' &&
            r.connectionId === hostId &&
            pathKey(r.path) === pathKey(repo.path) &&
            !this.db.prepare('SELECT id FROM resource_ids WHERE kind=?').get('ssh-binding:' + r.id),
        );
        const id = priorId ?? legacy?.id ?? randomUUID();
        if (!legacy || legacy.id !== id)
          this.db
            .prepare(
              "INSERT INTO repositories (id,connection_id,source,name,path,worktree_kind,created_at) VALUES (?,?,'ssh',?,?,?,?)",
            )
            .run(
              id,
              hostId,
              repo.name,
              repo.path,
              repo.worktreeKind ?? null,
              new Date().toISOString(),
            );
        if (!existing)
          this.db
            .prepare('INSERT INTO resource_ids(id,kind,local_key) VALUES (?,?,?)')
            .run(randomUUID(), 'ssh-binding:' + id, key);
        return this.get({ agentId: this.agentId, resourceId: id }, false);
      })
      .immediate();
  }
  hostBinding(localId: string) {
    const row = this.db
      .prepare('SELECT local_key FROM resource_ids WHERE kind=?')
      .get('ssh-binding:' + localId) as { local_key: string } | undefined;
    if (!row) return undefined;
    const [hostId, agentId, resourceId] = JSON.parse(row.local_key) as string[];
    return { hostId, resource: { agentId, resourceId } };
  }
  unregister(resource: ResourceRef) {
    const repository = this.get(resource, false);
    this.db.prepare('DELETE FROM repositories WHERE id = ?').run(resource.resourceId);
    return repository;
  }
  pin(resource: ResourceRef, pinned: boolean) {
    this.get(resource, false);
    this.db
      .prepare('UPDATE repositories SET pinned = ? WHERE id = ?')
      .run(Number(pinned), resource.resourceId);
    return this.get(resource, false);
  }
}
