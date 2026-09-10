export type TreeItem =
  | { kind: 'connection'; id: string }
  | { kind: 'repository'; id: string; connectionId: string };
export type Placement = 'before' | 'after';

export function orderedIds(ids: string[], saved: string[] = []): string[] {
  const available = new Set(ids);
  return [...new Set([...saved.filter((id) => available.has(id)), ...ids])];
}

export function orderItems<T extends { id: string }>(items: T[], saved: string[] = []): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return orderedIds(items.map((item) => item.id), saved).map((id) => byId.get(id)!);
}

export function canMoveTreeItem(source: TreeItem, target: TreeItem): boolean {
  return source.id !== target.id && source.kind === target.kind
    && (source.kind === 'connection'
      || (target.kind === 'repository' && source.connectionId === target.connectionId));
}

export function moveBeforeOrAfter(ids: string[], source: string, target: string, placement: Placement): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return ids;
  const result = ids.filter((id) => id !== source);
  result.splice(result.indexOf(target) + (placement === 'after' ? 1 : 0), 0, source);
  return result;
}
