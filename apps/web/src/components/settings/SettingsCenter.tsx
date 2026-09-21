import { useEffect, useRef } from 'react';
import { Alert, Button } from 'antd';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  DesktopOutlined,
  LayoutOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAiSettingsStore } from '../../stores/aiSettingsStore';
import type { useDesktopUpdates } from '../../hooks/useDesktopUpdates';
import { ProviderSettings } from './ProviderSettings';
import { CommitSettings } from './CommitSettings';
import { LayoutSettingsContent } from '../LayoutSettings';
import { UpdatePanelContent } from '../UpdatePanel';
import { Sparkles } from '../Sparkles';
import { BrandIcon } from '../BrandIcon';
import '../../settings.css';

const categories = [
  { id: 'providers', name: 'AI 服务商', icon: <ApartmentOutlined /> },
  { id: 'commit', name: '提交生成', icon: <Sparkles /> },
  { id: 'layout', name: '布局', icon: <LayoutOutlined /> },
  { id: 'updates', name: '版本更新', icon: <ReloadOutlined /> },
];

export function SettingsCenter({
  returnTo,
  updates,
}: {
  returnTo: string;
  updates: ReturnType<typeof useDesktopUpdates>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const category =
    categories.find((c) => c.id === location.pathname.split('/')[2]) || categories[0];
  const { settings, error, loading, load } = useAiSettingsStore();
  const back = useRef<HTMLButtonElement>(null);
  const select = (id: string) =>
    navigate(`/settings/${id}`, { replace: true, state: { returnTo } });
  useEffect(() => {
    void load();
    back.current?.focus();
  }, [load]);
  return (
    <div className="settings-center">
      <header className="settings-header">
        <div className="settings-brand">
          <BrandIcon />
          <strong>Alune</strong>
        </div>
        <div className="settings-header__bar">
          <span>
            <SettingOutlined /> 设置 <span className="settings-muted"> / {category.name}</span>
          </span>
          <Button
            ref={back}
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(returnTo)}
          >
            返回工作区
          </Button>
        </div>
      </header>
      <div className="settings-mobile-category">
        <label>
          设置分类
          <select
            aria-label="设置分类"
            value={category.id}
            onChange={(event) => select(event.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="settings-body">
        <aside className="settings-navigation" aria-label="设置分类">
          <nav>
            {categories.map((item, index) => (
              <div key={item.id}>
                {(index === 0 || index === 2) && (
                  <div className="settings-nav-group">{index === 0 ? 'AI' : '应用'}</div>
                )}
                <button
                  type="button"
                  aria-current={category.id === item.id ? 'page' : undefined}
                  onClick={() => select(item.id)}
                >
                  {item.icon}
                  {item.name}
                </button>
              </div>
            ))}
          </nav>
          <div className="settings-navigation__footer">
            <span>
              <DesktopOutlined /> 此设备的设置
            </span>
            <span>Alune · v{updates.state?.currentVersion || __APP_VERSION__}</span>
          </div>
        </aside>
        <main className="settings-main" aria-label={`${category.name}设置`}>
          {category.id === 'layout' ? (
            <div className="settings-page-content settings-page-content--layout">
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
                <Alert
                  type="info"
                  showIcon
                  title="当前运行方式不支持更新"
                  description="请使用已安装的正式桌面应用。Linux 需要运行 AppImage；开发环境不连接更新源。"
                />
              )}
            </div>
          ) : (
            <>
              {error && (
                <Alert
                  className="settings-load-alert"
                  type="error"
                  title={error}
                  action={
                    <Button size="small" onClick={() => void load()}>
                      重新加载
                    </Button>
                  }
                />
              )}
              {!settings && (
                <div className="settings-page-content" role="status">
                  {loading ? '正在读取 AI 设置…' : '无法读取 AI 设置，请重新加载。'}
                </div>
              )}
              {settings &&
                (category.id === 'providers' ? (
                  <ProviderSettings settings={settings} />
                ) : (
                  <CommitSettings settings={settings} onProviders={() => select('providers')} />
                ))}
            </>
          )}
        </main>
      </div>
      <footer className="settings-footer">
        <span>
          <DesktopOutlined /> 设置应用于此设备的所有仓库
        </span>
        <span>Alune · v{updates.state?.currentVersion || __APP_VERSION__}</span>
      </footer>
    </div>
  );
}
