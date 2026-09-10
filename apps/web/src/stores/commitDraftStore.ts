import { create } from 'zustand';

export interface CommitDraft {
  message: string;
  description: string;
}
export const EMPTY_DRAFT: CommitDraft = { message: '', description: '' };

// Session-only drafts survive panel and repository switches; they are not device preferences.
export const useCommitDraftStore = create<{
  drafts: Record<string, CommitDraft>;
  updateDraft: (id: string, patch: Partial<CommitDraft>) => void;
  clearSubmittedDraft: (id: string, submitted: CommitDraft) => void;
}>((set) => ({
  drafts: {},
  updateDraft: (id, patch) =>
    set((state) => ({
      drafts: { ...state.drafts, [id]: { ...(state.drafts[id] || EMPTY_DRAFT), ...patch } },
    })),
  clearSubmittedDraft: (id, submitted) =>
    set((state) => {
      const draft = state.drafts[id];
      if (
        !draft ||
        draft.message !== submitted.message ||
        draft.description !== submitted.description
      )
        return state;
      const drafts = { ...state.drafts };
      delete drafts[id];
      return { drafts };
    }),
}));
