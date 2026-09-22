import { Alert, Radio, Switch } from 'antd';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useWorkspaceStorageStatus } from '../../stores/workspaceStorage';
import { useAppearance } from '../../appearance';

export function AppearanceSettings() {
  const { appearance, updateAppearance } = useWorkspaceStore();
  const { theme, reduceMotion } = useAppearance();
  const error = useWorkspaceStorageStatus((state) => state.error);
  return (
    <div className="settings-page-content">
      <h1>外观</h1>
      <p className="settings-lead">调整主题色和动态效果，修改立即生效。</p>
      <fieldset className="settings-fieldset">
        <h2 id="appearance-theme-label">主题</h2>
        <p className="settings-field-hint">新装默认跟随系统。切换主题保留工作区布局和提交草稿。</p>
        <Radio.Group
          aria-labelledby="appearance-theme-label"
          value={appearance.theme}
          onChange={(event) => updateAppearance({ theme: event.target.value })}
          options={[
            { value: 'system', label: '跟随系统' },
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
          ]}
        />
        <p className="settings-field-hint">当前使用{theme === 'dark' ? '深色' : '浅色'}主题。</p>
        <h2 className="settings-subheading">动态效果</h2>
        <label className="settings-inline-actions">
          <Switch
            checked={appearance.reduceMotion}
            onChange={(reduceMotion) => updateAppearance({ reduceMotion })}
            aria-label="减少动态效果"
          />
          减少动态效果
        </label>
        <p className="settings-field-hint">
          关闭非必要动画，状态文字和操作结果仍会显示。系统开启减少动态效果时始终遵循系统设置。
          {reduceMotion && ' 当前已减少动态效果。'}
        </p>
      </fieldset>
      {error && <Alert type="error" showIcon title={error} />}
    </div>
  );
}
