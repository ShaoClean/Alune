import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AluneUIProvider,
  Button,
  Input,
  Select,
  Switch,
  AluneModal,
  DialogIcon,
  DialogCard,
  DialogPath,
  DialogNote,
  ToolbarButton,
  StatusButton,
  PanelHeader,
  StatusBadge,
  FileIcon,
  EmptyState,
  useFeedbackMessage,
} from '@alune/ui';
import '@alune/ui/styles.css';
import '../src/index.css';
import '../src/workspace-layout.css';
import '../src/theme.css';
import '../src/dialogs.css';
const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
function Fixture() {
  const [level, setLevel] = useState<0 | 2 | null>(null);
  const message = useFeedbackMessage();
  return (
    <main style={{ padding: 32, maxWidth: 900, margin: 'auto' }}>
      <h1>Alune-UI 迁移基线</h1>
      <PanelHeader title="工具栏与状态" count={3} />
      <div style={{ display: 'flex', gap: 8, marginBlock: 20, flexWrap: 'wrap' }}>
        <ToolbarButton label="历史" active>
          <DialogIcon name="clock" />
          历史
        </ToolbarButton>
        <ToolbarButton label="操作" variant="action">
          操作
        </ToolbarButton>
        <ToolbarButton label="推送" variant="primary">
          推送
        </ToolbarButton>
        <StatusButton label="连接状态">
          <StatusBadge status="connected" label="已连接" />
        </StatusButton>
        <StatusBadge status="dirty" label="待提交" />
        <StatusBadge status="error" label="失败" />
        <FileIcon path="example.tsx" />
      </div>
      <div style={{ display: 'flex', gap: 16, marginBlock: 24 }}>
        <Input aria-label="名称" placeholder="输入名称" />
        <Select
          aria-label="目标"
          defaultValue="local"
          options={[{ value: 'local', label: '本地' }]}
        />
        <Switch aria-label="启用" defaultChecked />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button id="ordinary" onClick={() => setLevel(0)}>
          普通弹窗
        </Button>
        <Button id="danger" danger onClick={() => setLevel(2)}>
          危险弹窗
        </Button>
        <Button id="feedback" onClick={() => message.error('示例操作未完成，请重试。')}>
          反馈
        </Button>
      </div>
      <EmptyState title="暂无记录" description="完成操作后会在此显示。" />
      <AluneModal
        open={level !== null}
        level={level ?? 0}
        tone={level === 2 ? 'danger' : 'default'}
        title={level === 2 ? '放弃本地更改？' : '保存配置'}
        description="组件提取前后的交互与外观保持一致。"
        typedConfirm={level === 2 ? { value: 'main' } : undefined}
        acknowledge={level === 2 ? '我了解此操作无法撤销' : undefined}
        onCancel={() => setLevel(null)}
        onOk={() => setLevel(null)}
      >
        <DialogCard pad>
          <DialogPath path="/example/alune" />
        </DialogCard>
        <DialogNote tone="warning" title="操作范围">
          此页面仅使用本地模拟数据。
        </DialogNote>
        <Input aria-label="配置名称" defaultValue="示例配置" />
      </AluneModal>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <AluneUIProvider theme={theme} reduceMotion>
    <Fixture />
  </AluneUIProvider>,
);
