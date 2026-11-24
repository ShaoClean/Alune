import { useEffect, useState } from 'react';
import { Radio, Switch } from '@alune/ui';
import type { CloseMode, DesktopPreferences } from '../../types/desktop-tray';

export function DesktopSettings() {
  const bridge = window.aluneTray!;
  const [prefs, setPrefs] = useState<DesktopPreferences>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const off = bridge.onPreferences((value) => {
      if (live) setPrefs(value);
    });
    bridge
      .getPreferences()
      .then((value) => {
        if (live) setPrefs(value);
      })
      .catch(() => {
        if (live) setError('无法读取桌面设置。');
      });
    return () => {
      live = false;
      off();
    };
  }, [bridge]);
  async function save(patch: { closeMode?: CloseMode; showTitle?: boolean }) {
    try {
      setPrefs(await bridge.setPreferences(patch));
      setError('');
    } catch {
      setError('无法保存桌面设置，请再试一次。');
    }
  }
  return (
    <div className="settings-page-content">
      <h1>桌面</h1>
      {error && <p role="alert">{error}</p>}
      {prefs && (
        <fieldset className="settings-fieldset appearance-preferences">
          <h2 id="desktop-close-mode">关闭主窗口时</h2>
          <Radio.Group
            aria-labelledby="desktop-close-mode"
            value={prefs.closeMode}
            disabled={!prefs.available}
            onChange={(e) => void save({ closeMode: e.target.value })}
            options={[
              { value: 'ask', label: '下次关闭时询问' },
              { value: 'hide', label: '隐藏到托盘' },
              {
                value: 'system',
                label: prefs.platform === 'darwin' ? '关闭窗口，保留应用' : '退出 Alune',
              },
            ]}
          />
          <p className="settings-field-hint">
            {prefs.available
              ? '隐藏后，已打开的仓库、终端和运行中的任务会保留。'
              : '系统托盘当前不可用，关闭窗口将使用系统默认行为。'}
          </p>
          {prefs.platform === 'darwin' && (
            <label className="settings-inline-actions">
              <Switch
                checked={prefs.showTitle}
                disabled={!prefs.available}
                aria-label="在菜单栏显示仓库和分支"
                onChange={(showTitle) => void save({ showTitle })}
              />
              在菜单栏显示仓库和分支
            </label>
          )}
        </fieldset>
      )}
    </div>
  );
}
