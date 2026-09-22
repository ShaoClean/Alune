import { useMemo } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider, theme as antTheme } from 'antd';
import type { ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { router } from './router';
import { useAppearance } from './appearance';

const queryClient = new QueryClient();

function App() {
  const { theme, reduceMotion } = useAppearance();
  const config = useMemo<ThemeConfig>(() => {
    // CSS owns the palette; Ant Design's portals use exactly the same resolved colors.
    const styles = getComputedStyle(document.documentElement);
    const color = (name: string) => styles.getPropertyValue(`--${name}`).trim();
    return {
      algorithm: theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: {
        colorPrimary: color('blue'),
        colorInfo: color('blue'),
        colorSuccess: color('green'),
        colorWarning: color('orange'),
        colorError: color('red'),
        colorBgBase: color('content'),
        colorBgLayout: color('content'),
        colorBgContainer: color('surface'),
        colorBgElevated: color('surface'),
        colorText: color('text'),
        colorTextSecondary: color('text-muted'),
        colorTextTertiary: color('text-muted'),
        colorTextQuaternary: color('text-muted'),
        colorTextPlaceholder: color('text-muted'),
        colorTextLightSolid: color('primary-on'),
        colorBorder: color('line-strong'),
        colorBorderSecondary: color('line'),
        colorPrimaryBg: color('blue-soft'),
        colorPrimaryHover: color('primary-hover'),
        controlOutline: color('focus-soft'),
        motion: !reduceMotion,
        motionDurationFast: '0.1s',
        motionDurationMid: '0.16s',
        motionDurationSlow: '0.22s',
        motionEaseInOut: 'cubic-bezier(.2,0,0,1)',
        borderRadius: 8,
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      },
      components: {
        Button: { controlHeight: 32, borderRadius: 7, primaryColor: color('primary-on') },
        Input: {
          controlHeight: 34,
          activeBorderColor: color('blue'),
          hoverBorderColor: color('blue'),
        },
        Select: {
          controlHeight: 34,
          activeBorderColor: color('blue'),
          hoverBorderColor: color('blue'),
        },
        Card: { borderRadiusLG: 10 },
      },
    };
  }, [theme, reduceMotion]);
  return (
    <ConfigProvider locale={zhCN} theme={config}>
      <AntApp component={false}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
