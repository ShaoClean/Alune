import { useEffect, useState } from 'react';
import { REPOSITORY_STATUS_CACHE_MS } from '@remote-git/shared';
import { useRepositoryStore } from '../stores/repositoryStore';

export function useRepositoryStatus(id: string) {
  const entry = useRepositoryStore((state) => state.repositoryStatuses[id]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (entry?.updatedAt === undefined) return;
    const remaining = entry.updatedAt + REPOSITORY_STATUS_CACHE_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => tick((value) => value + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [entry?.updatedAt]);
  return {
    entry,
    stale: Boolean(
      entry?.data &&
      (entry.stale ||
        entry.phase === 'error' ||
        Date.now() - entry.updatedAt! >= REPOSITORY_STATUS_CACHE_MS),
    ),
  };
}

// Cards and sidebar rows share requests; clipped and folded rows are not fetched.
export function useRepositoryVisibility(id: string) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!element) return;
    let stop: (() => void) | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !stop) stop = useRepositoryStore.getState().observeRepository(id);
      else if (!entry.isIntersecting && stop) {
        stop();
        stop = undefined;
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      stop?.();
    };
  }, [element, id]);
  return setElement;
}
