import { createContext } from 'react';
import { createFeedbackStore } from '../stores/feedbackStore';

export const emptyFeedbackStore = createFeedbackStore();
export const FeedbackContext = createContext<ReturnType<typeof createFeedbackStore> | null>(null);
export const FeedbackHostContext = createContext<{ id: string; active: boolean } | null>(null);

// Open dialogs in opening order. A dialog only claims messages while its own
// submission runs, so background results never land in an unrelated form.
const hosts: { id: string; submitting: () => boolean }[] = [];

export function registerFeedbackHost(id: string, submitting: () => boolean) {
  const host = { id, submitting };
  hosts.push(host);
  return () => {
    const index = hosts.indexOf(host);
    if (index >= 0) hosts.splice(index, 1);
  };
}

export function submittingFeedbackHost() {
  return hosts.findLast((host) => host.submitting())?.id;
}
