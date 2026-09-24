export type TreeItem =
  | { kind: 'connection'; id: string }
  | { kind: 'repository'; id: string; connectionId: string };
export type Placement = 'before' | 'after';

export function horizontalPlacement(clientX: number, left: number, width: number): Placement {
  return clientX < left + width / 2 ? 'before' : 'after';
}

export function orderedIds(ids: string[], saved: string[] = []): string[] {
  const available = new Set(ids);
  return [...new Set([...saved.filter((id) => available.has(id)), ...ids])];
}

export function orderItems<T extends { id: string }>(items: T[], saved: string[] = []): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return orderedIds(
    items.map((item) => item.id),
    saved,
  ).map((id) => byId.get(id)!);
}

export function canMoveTreeItem(source: TreeItem, target: TreeItem): boolean {
  return (
    source.id !== target.id &&
    source.kind === target.kind &&
    (source.kind === 'connection' ||
      (target.kind === 'repository' && source.connectionId === target.connectionId))
  );
}

export function moveBeforeOrAfter(
  ids: string[],
  source: string,
  target: string,
  placement: Placement,
): string[] {
  const sourceIndex = ids.indexOf(source);
  const targetIndex = ids.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return ids;
  const destination =
    targetIndex + (placement === 'after' ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
  if (destination === sourceIndex) return ids;
  const result = [...ids];
  result.splice(sourceIndex, 1);
  result.splice(destination, 0, source);
  return result;
}
