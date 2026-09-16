import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { aiApi, aiError } from '../api/ai';
import { defaultCommitModel, useAiSettingsStore } from '../stores/aiSettingsStore';
import { useCommitDraftStore } from '../stores/commitDraftStore';

export function useCommitGeneration(repoId: string, stagedSignature: string, stagedCount: number) {
  const location = useLocation();
  const navigate = useNavigate();
  const settings = useAiSettingsStore((state) => state.settings);
  const undo = useCommitDraftStore((state) => state.undo[repoId]);
  const controller = useRef<AbortController | null>(null);
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const model = defaultCommitModel(settings);
  const cancel = useCallback(
    (reason = '已取消生成，草稿已保留。') => {
      if (!controller.current) return;
      controller.current.abort();
      controller.current = null;
      useCommitDraftStore.getState().cancelGeneration(repoId);
      setGenerating(false);
      setFeedback({ error: false, message: reason });
    },
    [repoId],
  );

  useEffect(() => {
    void useAiSettingsStore.getState().load();
  }, []);
  useEffect(() => () => cancel(), [cancel]);
  // This also runs when the workspace is retained but hidden behind settings.
  useLayoutEffect(() => {
    cancel('工作区或暂存内容已变化，请重新生成。');
  }, [repoId, stagedSignature, location.pathname, settings?.revision, cancel]);
  useEffect(
    () =>
      useCommitDraftStore.subscribe((state, previous) => {
        if (controller.current && previous.generations[repoId] && !state.generations[repoId])
          cancel('草稿已更新，本次生成已取消。');
      }),
    [repoId, cancel],
  );

  const openSettings = (category = 'commit') =>
    navigate(`/settings/${category}`, {
      state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
    });
  const generate = async () => {
    if (!settings || !model) {
      openSettings(model ? 'commit' : 'providers');
      return;
    }
    if (!stagedCount) {
      setFeedback({ error: true, message: '没有已暂存的改动，请先暂存需要提交的文件。' });
      return;
    }
    cancel();
    const active = new AbortController();
    controller.current = active;
    const ticket = useCommitDraftStore.getState().beginGeneration(repoId);
    setGenerating(true);
    setFeedback(null);
    try {
      const result = await aiApi.generate(repoId, settings.revision, active.signal);
      if (controller.current !== active || active.signal.aborted) return;
      controller.current = null;
      if (result.configRevision !== useAiSettingsStore.getState().settings?.revision) return;
      if (
        useCommitDraftStore.getState().applyGeneration(repoId, ticket, {
          message: result.message,
          description: result.description,
        })
      ) {
        setFeedback({ error: false, message: '已填入提交信息，可编辑后提交。' });
      }
    } catch (error) {
      if (controller.current === active && !active.signal.aborted)
        setFeedback({ error: true, message: aiError(error) });
    } finally {
      if (controller.current === active) controller.current = null;
      // A cancelled, older request cannot change the newer generation's state.
      if (!controller.current) setGenerating(false);
      useCommitDraftStore.getState().cancelGeneration(repoId, ticket);
    }
  };
  return {
    model,
    generating,
    feedback,
    undo,
    generate,
    cancel,
    openSettings,
    undoGeneration: () => {
      cancel();
      useCommitDraftStore.getState().undoGeneration(repoId);
      setFeedback(null);
    },
  };
}
