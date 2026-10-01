import { useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { App, ConfigProvider, theme as antTheme } from 'antd';
import type { ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN.js';
import { UIAppearanceContext } from './appearance';
import { FeedbackProvider } from './components/Feedback';
import { AluneConfirmProvider } from './components/AluneModal';
import { DialogIcon } from './components/DialogIcons';

export interface AluneUIProviderProps {
  theme: 'light' | 'dark';
  reduceMotion?: boolean;
  children: ReactNode;
}
// Moonlight overlay skins (dialogs.css). AluneModal adds the shell and levels;
// these defaults keep any remaining Ant Design overlay on the same surfaces.
const modalConfig = {
  centered: true,
  mask: { blur: true },
  closeIcon: <DialogIcon name="x" />,
  classNames: {
    root: 'a-dlg',
    mask: 'a-dlg-scrim',
    container: 'a-dlg-core',
    header: 'a-dlg-head',
    body: 'a-dlg-body',
    footer: 'a-dlg-foot',
  },
};
const popconfirmConfig = { arrow: false, classNames: { root: 'a-pop' } };
const dropdownConfig = { classNames: { root: 'a-menu' } };
const popoverConfig = { arrow: false, classNames: { root: 'a-pop' } };

function resolveTheme(theme: 'light' | 'dark', reduceMotion: boolean): ThemeConfig {
  // CSS owns the palette; Ant Design's portals use exactly the same resolved colors.
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(`--${name}`).trim();
  return {
    algorithm: theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: color('blue'),
      colorInfo: color('cyan'),
      colorInfoBg: color('cyan-soft'),
      colorInfoBorder: color('cyan-line'),
      colorSuccessBg: color('green-soft'),
      colorSuccessBorder: color('green-line'),
      colorWarningBg: color('orange-soft'),
      colorWarningBorder: color('orange-line'),
      colorErrorBg: color('red-soft'),
      colorErrorBorder: color('red-line'),
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
      motionDurationFast: '0.14s',
      motionDurationMid: '0.16s',
      motionDurationSlow: '0.22s',
      motionEaseInOut: 'cubic-bezier(.2,0,0,1)',
      borderRadius: 10,
      fontFamily: color('font-sans'),
    },
    components: {
      Button: { controlHeight: 32, borderRadius: 999, primaryColor: color('primary-on') },
      Input: {
        controlHeight: 34,
        activeBorderColor: color('blue'),
        hoverBorderColor: color('field-ring-hover'),
        colorBgContainer: color('field-bg'),
        colorBorder: color('field-ring'),
      },
      Select: {
        controlHeight: 34,
        activeBorderColor: color('blue'),
        hoverBorderColor: color('field-ring-hover'),
        colorBgContainer: color('field-bg'),
        colorBorder: color('field-ring'),
      },
      Card: { borderRadiusLG: 12 },
      Tag: { defaultBg: color('chip-bg'), defaultColor: color('text-muted') },
      Segmented: {
        trackBg: color('seg-bg'),
        itemSelectedBg: color('seg-thumb'),
        itemSelectedColor: color('text'),
      },
    },
  };
}

/** One theme owner per document. Host resolves system preferences; portals share root tokens. */
export function AluneUIProvider({ theme, reduceMotion = false, children }: AluneUIProviderProps) {
  const appearance = useMemo(() => ({ theme, reduceMotion }), [theme, reduceMotion]);
  const [config, setConfig] = useState<ThemeConfig>({});
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = { theme: root.dataset.theme, motion: root.dataset.reducedMotion };
    root.dataset.theme = theme;
    root.dataset.reducedMotion = String(reduceMotion);
    setConfig(resolveTheme(theme, reduceMotion));
    return () => {
      if (root.dataset.theme === theme) {
        if (previous.theme === undefined) delete root.dataset.theme;
        else root.dataset.theme = previous.theme;
      }
      if (root.dataset.reducedMotion === String(reduceMotion)) {
        if (previous.motion === undefined) delete root.dataset.reducedMotion;
        else root.dataset.reducedMotion = previous.motion;
      }
    };
  }, [theme, reduceMotion]);
  return (
    <UIAppearanceContext.Provider value={appearance}>
      <ConfigProvider
        locale={zhCN}
        theme={config}
        modal={modalConfig}
        popconfirm={popconfirmConfig}
        dropdown={dropdownConfig}
        popover={popoverConfig}
      >
        <App component={false}>
          <FeedbackProvider>
            <AluneConfirmProvider>{children}</AluneConfirmProvider>
          </FeedbackProvider>
        </App>
      </ConfigProvider>
    </UIAppearanceContext.Provider>
  );
}
