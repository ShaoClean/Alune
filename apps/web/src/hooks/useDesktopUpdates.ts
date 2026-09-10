import { useCallback, useEffect, useState } from 'react';
import type { DesktopUpdates, UpdateState } from '../types/desktop-updates';

type UpdateAction = Exclude<keyof DesktopUpdates, 'subscribe'>;

export function useDesktopUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const accept = useCallback((next: UpdateState) => {
    setState((previous) => !previous || next.revision >= previous.revision ? next : previous);
  }, []);

  useEffect(() => {
    const bridge = window.desktopUpdates;
    if (!bridge) return;
    let alive = true;
    const unsubscribe = bridge.subscribe((next) => { if (alive) accept(next); });
    void bridge.getState().then((next) => { if (alive) accept(next); }).catch(() => {
      if (alive) setBridgeError('无法连接桌面更新服务，请刷新页面后重试。');
    });
    return () => { alive = false; unsubscribe(); };
  }, [accept]);

  const invoke = useCallback(async (action: UpdateAction) => {
    const bridge = window.desktopUpdates;
    if (!bridge) return;
    setBridgeError(null);
    try { accept(await bridge[action]()); }
    catch { setBridgeError('更新操作未能完成，请重试或重新启动应用。'); }
  }, [accept]);

  return { state, bridgeError, invoke, isDesktop: Boolean(window.desktopUpdates) };
}
