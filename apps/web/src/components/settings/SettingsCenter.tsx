import { FeedbackAlert } from '../FeedbackAlert';
import { FeedbackNotice } from '../Feedback';
import { AppearanceSettings } from './AppearanceSettings';
import { useEffect } from 'react';
import { Button } from 'antd';
import {
  ApartmentOutlined,
  LayoutOutlined,
  ReloadOutlined,
  SkinOutlined,
  KeyOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useAiSettingsStore } from '../../stores/aiSettingsStore';
import type { useDesktopUpdates } from '../../hooks/useDesktopUpdates';
import { ProviderSettings } from './ProviderSettings';
import { CommitSettings } from './CommitSettings';
import { LayoutSettingsContent } from '../LayoutSettings';
import { UpdatePanelContent } from '../UpdatePanel';
import { Sparkles } from '../Sparkles';
import { AccessTokenSettings } from './AccessTokenSettings';
import { ProxySettings } from './ProxySettings';
import '../../settings.css';

const categories = [
  { id: 'providers', name: 'AI 服务商', icon: <ApartmentOutlined /> },
  { id: 'commit', name: '提交生成', icon: <Sparkles /> },
  { id: 'tokens', name: '访问令牌', icon: <KeyOutlined /> },
  { id: 'layout', name: '布局', icon: <LayoutOutlined /> },
  { id: 'appearance', name: '外观', icon: <SkinOutlined /> },
  { id: 'proxy', name: '网络代理', icon: <GlobalOutlined /> },
  { id: 'updates', name: '版本更新', icon: <ReloadOutlined /> },
];

export const getSettingsCategory = (pathname: string) =>
  categories.find((category) => category.id === pathname.split('/')[2]) || categories[0];

export function SettingsNavigation({
  category,
  onSelect,
}: {
  category: ReturnType<typeof getSettingsCategory>;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="settings-category-nav" aria-label="设置分类">
      {['AI', '应用'].map((group, index) => (
        <section key={group} aria-label={group}>
          <div className="sidebar-section__heading">{group}</div>
          {categories.slice(index === 0 ? 0 : 2, index === 0 ? 2 : undefined).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-nav-item${category.id === item.id ? ' sidebar-nav-item--active' : ''}`}
              aria-current={category.id === item.id ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
            >
              <span className="sidebar-nav-item__icon">{item.icon}</span>
              <span className="sidebar-nav-item__label">{item.name}</span>
            </button>
          ))}
        </section>
      ))}
    </nav>
  );
}

export function SettingsCenter({
  returnTo,
  updates,
  category,
  onSelect,
}: {
  category: ReturnType<typeof getSettingsCategory>;
  onSelect: (id: string) => void;
  returnTo: string;
  updates: ReturnType<typeof useDesktopUpdates>;
}) {
  const { settings, error, loading, load } = useAiSettingsStore();
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section
      className={`app-content settings-main settings-main--${category.id}`}
      aria-label={`${category.name}设置`}
    >
      {category.id === 'tokens' ? (
        <AccessTokenSettings returnTo={returnTo} />
      ) : category.id === 'proxy' ? (
        <ProxySettings />
      ) : category.id === 'appearance' ? (
        <AppearanceSettings />
      ) : category.id === 'layout' ? (
        <div className="settings-page-content">
          <h1>布局</h1>
          <p className="settings-lead">调整工作区的显示空间，修改立即生效。</p>
          <LayoutSettingsContent />
        </div>
      ) : category.id === 'updates' ? (
        <div className="settings-page-content">
          <h1>版本更新</h1>
          <p className="settings-lead">检查与安装 Alune 的新版本。离开设置后下载会继续。</p>
          {updates.isDesktop ? (
            <UpdatePanelContent
              state={updates.state}
              error={updates.bridgeError}
              invoke={updates.invoke}
            />
          ) : (
            <FeedbackAlert
              source="SettingsCenter-1"
              type="info"
              title="当前运行方式不支持更新"
              description="请使用已安装的正式桌面应用。Linux 需要运行 AppImage；开发环境不连接更新源。"
            />
          )}
        </div>
      ) : (
        <>
          <FeedbackNotice
            source="ai-settings"
            title={error ? 'AI 设置读取失败' : null}
            description={error || undefined}
            actionLabel="重新加载"
            busy={loading}
            onAction={load}
          />
          {!settings && (
            <div className="settings-page-content" role="status">
              {loading ? (
                '正在读取 AI 设置…'
              ) : (
                <>
                  无法读取 AI 设置。<Button onClick={() => void load()}>重新加载</Button>
                </>
              )}
            </div>
          )}
          {settings &&
            (category.id === 'providers' ? (
              <ProviderSettings settings={settings} />
            ) : (
              <CommitSettings settings={settings} onProviders={() => onSelect('providers')} />
            ))}
        </>
      )}
    </section>
  );
}
