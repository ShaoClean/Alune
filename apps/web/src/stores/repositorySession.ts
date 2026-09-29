export interface RepositorySession {
  ids: string[];
  activeId: string | null;
}

export function readRepositorySession(value: unknown): RepositorySession {
  const saved = value && typeof value === 'object' ? (value as Partial<RepositorySession>) : {};
  const ids = Array.isArray(saved.ids)
    ? [...new Set(saved.ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  return {
    ids,
    activeId:
      typeof saved.activeId === 'string' && ids.includes(saved.activeId)
        ? saved.activeId
        : (ids[0] ?? null),
  };
}

// Prefer the next surviving tab, then the previous one, just like closing a tab.
export function removeSessionRepositories(
  session: RepositorySession,
  removed: string[],
  preferredId?: string,
): RepositorySession {
  const closing = new Set(removed);
  const ids = session.ids.filter((id) => !closing.has(id));
  if (!session.activeId || !closing.has(session.activeId)) return { ...session, ids };
  const index = session.ids.indexOf(session.activeId);
  const activeId =
    preferredId && ids.includes(preferredId)
      ? preferredId
      : (session.ids.slice(index + 1).find((id) => !closing.has(id)) ??
        session.ids
          .slice(0, index)
          .reverse()
          .find((id) => !closing.has(id)) ??
        null);
  return { ids, activeId };
}
