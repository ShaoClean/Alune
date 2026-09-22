import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject, SyntheticEvent } from 'react';

// A modal dialog uses the browser's top layer, so resizing the workspace cannot
// clip it. Switching between modal and inline keeps the same content mounted.
export function useDiffFullscreen(bodyRef: RefObject<HTMLDivElement | null>, contentKey: string) {
  const [fullscreen, setFullscreen] = useState(false);
  const shellRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnPosition = useRef<{ top: number; left: number; contentKey: string } | null>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (fullscreen) {
      shell.close();
      shell.showModal();
      shell
        .querySelector<HTMLButtonElement>('[aria-label="退出全屏查看"]')
        ?.focus({ preventScroll: true });
    } else {
      // close() restores focus and releases the background's native inert state.
      if (shell.matches(':modal')) shell.close();
      if (!shell.open) shell.show();
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
    }
    const position = returnPosition.current;
    if (position?.contentKey === contentKey) bodyRef.current?.scrollTo(position);
    if (!fullscreen) returnPosition.current = null;
  }, [fullscreen]);

  const toggleFullscreen = () => {
    if (!fullscreen) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const body = bodyRef.current;
      returnPosition.current = {
        top: body?.scrollTop || 0,
        left: body?.scrollLeft || 0,
        contentKey,
      };
    }
    setFullscreen((value) => !value);
  };

  const onFullscreenKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    // Native Tab and Escape handling remains available, while background
    // workspace shortcuts cannot change saved layout beneath the dialog.
    if (fullscreen) event.stopPropagation();
  };
  const onFullscreenCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    setFullscreen(false);
  };
  const onFullscreenClose = () => {
    if (!shellRef.current?.open) setFullscreen(false);
  };

  return {
    fullscreen,
    shellRef,
    toggleFullscreen,
    onFullscreenKeyDown,
    onFullscreenCancel,
    onFullscreenClose,
  };
}
