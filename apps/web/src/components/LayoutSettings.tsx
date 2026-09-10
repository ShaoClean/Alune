import { Button, Modal, Switch } from 'antd';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { CHANGES_MAX, CHANGES_MIN, SIDEBAR_MAX, SIDEBAR_MIN } from '../stores/workspaceLayout';

export function LayoutSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { layout, updateLayout, resetLayout } = useWorkspaceStore();
  return (
    <Modal
      title="布局设置"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>完成</Button>}
      width={420}
    >
      <div className="layout-settings">
        <p>窗口较小时自动适配；放大后恢复已保存的宽度。</p>
        <label>
          工作区宽度 <output>{layout.sidebarWidth} px</output>
          <input
            type="range"
            aria-label="工作区宽度"
            min={SIDEBAR_MIN}
            max={SIDEBAR_MAX}
            value={layout.sidebarWidth}
            onChange={(event) => updateLayout({ sidebarWidth: Number(event.target.value) })}
          />
        </label>
        <label>
          改动列表宽度 <output>{layout.changesWidth} px</output>
          <input
            type="range"
            aria-label="改动列表宽度"
            min={CHANGES_MIN}
            max={CHANGES_MAX}
            value={layout.changesWidth}
            onChange={(event) => updateLayout({ changesWidth: Number(event.target.value) })}
          />
        </label>
        <div className="layout-settings__toggle">
          <span>收起工作区</span>
          <Switch
            aria-label="收起工作区"
            checked={layout.sidebarCollapsed}
            onChange={(sidebarCollapsed) => updateLayout({ sidebarCollapsed })}
          />
        </div>
        <Button onClick={resetLayout}>恢复默认布局</Button>
        <p>布局在此设备保存，恢复默认布局会保留工作区树的展开与排序设置。</p>
      </div>
    </Modal>
  );
}
