import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryAnalyticsEntry } from '@alune/shared';
import { ANALYTICS_BATCH_SIZE } from '@alune/shared';
import { repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { repositoryGroupId } from '../stores/repositorySource';

export function useRepositoryAnalytics(ids: string[], revision: number) {
  const [entries, setEntries] = useState<Record<string, RepositoryAnalyticsEntry>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const idsKey = JSON.stringify(ids);
  const load = useCallback(
    async (collect: boolean, refresh = false, selectedIds?: string[]) => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      setBusy(true);
      setProgress(0);
      let targets: string[] = selectedIds ?? JSON.parse(idsKey);
      if (collect) {
        const registry = new Map(
          useRepositoryStore.getState().repositories.map((repo) => [repo.id, repo]),
        );
        const groups = new Map<string, string[]>();
        for (const id of targets) {
          const repo = registry.get(id);
          const source = repo ? repositoryGroupId(repo) : '@unknown';
          if (!groups.has(source)) groups.set(source, []);
          groups.get(source)!.push(id);
        }
        targets = [];
        while (groups.size)
          for (const [source, group] of groups) {
            targets.push(group.shift()!);
            if (!group.length) groups.delete(source);
          }
      }
      try {
        // The server schedules at most three readers; aggregate up to 20 summaries
        // per HTTP request and share the existing bounded status queue.
        const size = ANALYTICS_BATCH_SIZE;
        for (let offset = 0; offset < targets.length; offset += size) {
          if (request.signal.aborted) break;
          const batch = targets.slice(offset, offset + size);
          try {
            const results = await repositoryApi.analytics(batch, collect, refresh, request.signal);
            if (request.signal.aborted) break;
            setEntries((previous) => ({
              ...previous,
              ...Object.fromEntries(results.map((entry) => [entry.id, entry])),
            }));
            // A failed source already has actionable feedback; do not immediately
            // reconnect it once per repository through the separate status queue.
            if (collect)
              await useRepositoryStore
                .getState()
                .refreshRepositoryStatuses(
                  results.filter((entry) => !entry.error).map((entry) => entry.id),
                );
          } catch (error) {
            if (request.signal.aborted) break;
            setEntries((previous) => ({
              ...previous,
              ...Object.fromEntries(
                batch.map((id) => [
                  id,
                  {
                    ...previous[id],
                    id,
                    error: error instanceof Error ? error.message : '统计读取失败',
                  },
                ]),
              ),
            }));
          }
          if (!request.signal.aborted) setProgress(Math.min(offset + size, targets.length));
        }
      } finally {
        if (controller.current === request) setBusy(false);
      }
    },
    [idsKey],
  );
  useEffect(() => {
    void load(false);
    return () => controller.current?.abort();
  }, [load, revision]);
  return {
    entries,
    busy,
    progress,
    collect: (refresh = false) => load(true, refresh),
    retry: (id: string) => load(true, true, [id]),
    cancel: () => {
      controller.current?.abort();
      setBusy(false);
    },
  };
}
