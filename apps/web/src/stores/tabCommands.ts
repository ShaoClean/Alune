export type TabCloseCommand = 'current' | 'others' | 'right' | 'left';

/** Tabs a close command removes, in visible order; empty when there is nothing to close. */
export function tabsToClose(ids: string[], target: string, command: TabCloseCommand): string[] {
  const index = ids.indexOf(target);
  if (index < 0) return [];
  switch (command) {
    case 'current':
      return [target];
    case 'others':
      return ids.filter((id) => id !== target);
    case 'right':
      return ids.slice(index + 1);
    case 'left':
      return ids.slice(0, index);
  }
}
