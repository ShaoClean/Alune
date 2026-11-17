import type { KeyboardEvent } from 'react';

// Scope Escape to the dialog that owns keyboard focus. A background tooltip's
// portal must not become the owner of a focused modal's cancel action.
export function handleDialogEscape(
  event: KeyboardEvent<HTMLDivElement>,
  options: { enabled: boolean; busy: boolean; compositionEndedAt: number; cancel: () => void },
) {
  if (!options.enabled || event.key !== 'Escape' || event.defaultPrevented ||
      event.nativeEvent.isComposing || Date.now() - options.compositionEndedAt < 200 ||
      !event.currentTarget.contains(event.target as Node) ||
      (event.target as HTMLElement | null)?.closest?.('[role=combobox][aria-expanded=true], [aria-haspopup][aria-expanded=true]')) return false;
  event.preventDefault();
  event.stopPropagation();
  if (!options.busy) options.cancel();
  return true;
}
