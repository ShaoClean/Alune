import { create } from 'zustand';

export interface CommitDraft {
  message: string;
  description: string;
}
export const EMPTY_DRAFT: CommitDraft = { message: '', description: '' };

export interface GenerationTicket {
  before: CommitDraft;
}

// Session-only drafts survive panel and repository switches; they are not device preferences.
export const useCommitDraftStore = create<{
  drafts: Record<string, CommitDraft>;
  generations: Record<string, GenerationTicket | undefined>;
  undo: Record<string, { before: CommitDraft; generated: CommitDraft } | undefined>;
  beginGeneration: (id: string) => GenerationTicket;
  cancelGeneration: (id: string, ticket?: GenerationTicket) => void;
  applyGeneration: (id: string, ticket: GenerationTicket, draft: CommitDraft) => boolean;
  undoGeneration: (id: string) => void;
  updateDraft: (id: string, patch: Partial<CommitDraft>) => void;
  clearSubmittedDraft: (id: string, submitted: CommitDraft) => void;
}>((set, get) => ({
  drafts: {},
  generations: {},
  undo: {},
  beginGeneration: (id) => {
    const ticket = { before: get().drafts[id] || EMPTY_DRAFT };
    set((state) => ({ generations: { ...state.generations, [id]: ticket } }));
    return ticket;
  },
  cancelGeneration: (id, ticket) =>
    set((state) => {
      if (ticket && state.generations[id] !== ticket) return state;
      return { generations: { ...state.generations, [id]: undefined } };
    }),
  applyGeneration: (id, ticket, draft) => {
    const state = get();
    if (state.generations[id] !== ticket || (state.drafts[id] || EMPTY_DRAFT) !== ticket.before)
      return false;
    set({
      drafts: { ...state.drafts, [id]: draft },
      generations: { ...state.generations, [id]: undefined },
      undo: { ...state.undo, [id]: { before: ticket.before, generated: draft } },
    });
    return true;
  },
  undoGeneration: (id) =>
    set((state) => {
      const undo = state.undo[id];
      if (!undo || undo.generated !== state.drafts[id]) return state;
      return {
        drafts: { ...state.drafts, [id]: undo.before },
        undo: { ...state.undo, [id]: undefined },
        generations: { ...state.generations, [id]: undefined },
      };
    }),
  updateDraft: (id, patch) =>
    set((state) => ({
      drafts: { ...state.drafts, [id]: { ...(state.drafts[id] || EMPTY_DRAFT), ...patch } },
      generations: { ...state.generations, [id]: undefined },
      undo: { ...state.undo, [id]: undefined },
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
      return {
        drafts,
        undo: { ...state.undo, [id]: undefined },
        generations: { ...state.generations, [id]: undefined },
      };
    }),
}));
