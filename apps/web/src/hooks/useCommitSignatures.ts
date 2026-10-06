import { useEffect, useState } from 'react';
import type { CommitSignature } from '@alune/shared';
import { gitApi } from '../api';

/** Verify only rendered commits; scrolling cancels obsolete work, refresh drops trust results. */
export function useCommitSignatures(repoId: string, hashes: string[], generation: number) {
  const key = JSON.stringify(hashes);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    scope: string;
    values: Record<string, CommitSignature>;
    error: string;
  }>({ scope: '', values: {}, error: '' });
  const scope = `${repoId}:${generation}:${attempt}`;
  const values = state.scope === scope ? state.values : {};
  useEffect(() => {
    const controller = new AbortController();
    const missing = (JSON.parse(key) as string[]).filter((hash) => !values[hash]);
    if (!missing.length) return;
    const timer = setTimeout(async () => {
      try {
        for (let i = 0; i < missing.length; i += 100) {
          const results = await gitApi.signatures(
            repoId,
            missing.slice(i, i + 100),
            controller.signal,
          );
          if (controller.signal.aborted) return;
          setState((previous) => ({
            scope,
            error: '',
            values: {
              ...(previous.scope === scope ? previous.values : {}),
              ...Object.fromEntries(results.map((item) => [item.hash, item])),
            },
          }));
        }
      } catch (error: any) {
        if (!controller.signal.aborted)
          setState((previous) => ({
            scope,
            values: previous.scope === scope ? previous.values : {},
            error: error.message || '无法验证提交签名',
          }));
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [repoId, key, scope]);
  return {
    values,
    error: state.scope === scope ? state.error : '',
    retry: () => setAttempt((value) => value + 1),
  };
}
