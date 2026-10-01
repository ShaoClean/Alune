import { createContext } from 'react';
import { createFeedbackStore } from '../stores/feedbackStore';

export const emptyFeedbackStore = createFeedbackStore();
export const FeedbackContext = createContext<ReturnType<typeof createFeedbackStore> | null>(null);
export const FeedbackHostContext = createContext<{ id: string; active: boolean } | null>(null);
