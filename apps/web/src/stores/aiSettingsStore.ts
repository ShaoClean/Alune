import { create } from 'zustand';
import type { AiSettings } from '@alune/shared';
import { aiApi, aiError } from '../api/ai';

let request = 0;
export const useAiSettingsStore = create<{
  settings: AiSettings | null;
  error: string | null;
  loading: boolean;
  load: () => Promise<void>;
  accept: (settings: AiSettings) => void;
}>((set) => ({
  settings: null,
  error: null,
  loading: false,
  accept: (settings) => {
    request++;
    set({ settings, error: null, loading: false });
  },
  load: async () => {
    const current = ++request;
    set({ loading: true, error: null });
    try {
      const settings = await aiApi.settings();
      if (current === request) set({ settings, loading: false });
    } catch (error) {
      if (current === request) set({ error: aiError(error), loading: false });
    }
  },
}));

export function defaultCommitModel(settings: AiSettings | null) {
  const provider = settings?.providers.find(
    (p) => p.id === settings.commit.providerId && p.enabled,
  );
  const model = provider?.models.find((m) => m.id === settings?.commit.modelId && m.enabled);
  return provider && model ? { provider, model } : null;
}
