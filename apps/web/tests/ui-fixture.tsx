import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, Button, ConfigProvider, Input, Select, Switch, theme as antTheme } from 'antd';
import type { ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useAppearance } from '../src/appearance';
import { FeedbackProvider } from '../src/components/Feedback';
import { AluneConfirmProvider, AluneModal } from '../src/components/AluneModal';
import { DialogIcon } from '../src/components/DialogIcons';
import { DialogCard, DialogPath, DialogNote } from '../src/components/DialogParts';
import { ToolbarButton } from '../src/components/ToolbarButton';
import { StatusButton } from '../src/components/StatusButton';
import { PanelHeader, StatusBadge, FileIcon, EmptyState } from '../src/components/ui';
import { useFeedbackMessage } from '../src/components/useFeedbackMessage';
import '../src/index.css';
import '../src/workspace-layout.css';
import '../src/theme.css';
import '../src/dialogs.css';
const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
useAppearance.setState({ theme, reduceMotion: true });
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

function BaselineProvider({ children }: { children: React.ReactNode }) {
  const { theme, reduceMotion } = useAppearance();
  const config = useMemo<ThemeConfig>(() => {
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
  }, [theme, reduceMotion]);
  return <ConfigProvider locale={zhCN} theme={config} modal={modalConfig} popconfirm={popconfirmConfig} dropdown={dropdownConfig} popover={popoverConfig}><AntApp component={false}><FeedbackProvider><AluneConfirmProvider>{children}</AluneConfirmProvider></FeedbackProvider></AntApp></ConfigProvider>;
}
function Fixture() {
  const [level, setLevel] = useState<0 | 2 | null>(null);
  const message = useFeedbackMessage();
  return <main style={{padding:32, maxWidth:900, margin:'auto'}}>
    <h1>Alune-UI 迁移基线</h1>
    <PanelHeader title="工具栏与状态" count={3}/>
    <div style={{display:'flex', gap:8, marginBlock:20, flexWrap:'wrap'}}>
      <ToolbarButton label="历史" active><DialogIcon name="clock"/>历史</ToolbarButton>
      <ToolbarButton label="操作" variant="action">操作</ToolbarButton>
      <ToolbarButton label="推送" variant="primary">推送</ToolbarButton>
      <StatusButton label="连接状态"><StatusBadge status="connected" label="已连接"/></StatusButton>
      <StatusBadge status="dirty" label="待提交"/><StatusBadge status="error" label="失败"/>
      <FileIcon path="example.tsx"/>
    </div>
    <div style={{display:'flex', gap:16, marginBlock:24}}>
      <Input aria-label="名称" placeholder="输入名称"/>
      <Select aria-label="目标" defaultValue="local" options={[{value:'local', label:'本地'}]}/>
      <Switch aria-label="启用" defaultChecked/>
    </div>
    <div style={{display:'flex', gap:8}}>
      <Button id="ordinary" onClick={()=>setLevel(0)}>普通弹窗</Button>
      <Button id="danger" danger onClick={()=>setLevel(2)}>危险弹窗</Button>
      <Button id="feedback" onClick={()=>message.error('示例操作未完成，请重试。')}>反馈</Button>
    </div>
    <EmptyState title="暂无记录" description="完成操作后会在此显示。"/>
    <AluneModal open={level!==null} level={level??0} tone={level===2?'danger':'default'} title={level===2?'放弃本地更改？':'保存配置'} description="组件提取前后的交互与外观保持一致。" typedConfirm={level===2?{value:'main'}:undefined} acknowledge={level===2?'我了解此操作无法撤销':undefined} onCancel={()=>setLevel(null)} onOk={()=>setLevel(null)}>
      <DialogCard pad><DialogPath path="/example/alune"/></DialogCard>
      <DialogNote tone="warning" title="操作范围">此页面仅使用本地模拟数据。</DialogNote>
      <Input aria-label="配置名称" defaultValue="示例配置"/>
    </AluneModal>
  </main>;
}
createRoot(document.getElementById('root')!).render(<BaselineProvider><Fixture/></BaselineProvider>);
