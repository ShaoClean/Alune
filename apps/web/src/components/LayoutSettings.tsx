import { Button, Segmented, Switch } from '@alune/ui';
import type { CSSProperties } from 'react';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { CHANGES_MAX, CHANGES_MIN, SIDEBAR_MAX, SIDEBAR_MIN } from '../stores/workspaceLayout';
import { AluneModal, DialogHints, Kbd } from '@alune/ui';
import { DialogCard } from '@alune/ui';
import { DialogIcon } from '@alune/ui';

// The slider skin paints the track up to --fill.
const fill = (value: number, min: number, max: number) =>
  ({ '--fill': `${((value - min) / (max - min)) * 100}%` }) as CSSProperties;

export function LayoutSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { layout, updateLayout, resetLayout } = useWorkspaceStore();
  return (
    <AluneModal
      size={420}
      glyph="columns"
      eyebrow={{ label: '工作区', detail: '此设备' }}
      title="布局设置"
      open={open}
      onCancel={onClose}
      hints={
        <DialogHints>
          <span>即时生效 · 此设备保存</span>
        </DialogHints>
      }
      footer={
        <>
          <Button type="text" title="保留工作区树的展开与排序" onClick={resetLayout}>
            恢复默认
          </Button>
          <Button autoFocus onClick={onClose}>
            完成
          </Button>
        </>
      }
    >
      <p className="dlg-sub">
        <span>侧边面板</span>
      </p>
      <DialogCard>
        <div className="dlg-sw-row">
          <span>
            显示左侧工作区
            <small>
              连接与仓库 · <Kbd>⌘ / Ctrl</Kbd> <Kbd>B</Kbd>
            </small>
          </span>
          <Switch
            aria-label="显示左侧工作区"
            checked={!layout.sidebarCollapsed}
            onChange={(visible) => updateLayout({ sidebarCollapsed: !visible })}
          />
        </div>
        <div className="dlg-sw-row">
          <span>
            显示右侧面板
            <small>
              改动、提交与历史 · <Kbd>⌘ / Ctrl</Kbd> <Kbd>⇧</Kbd> <Kbd>B</Kbd>
            </small>
          </span>
          <Switch
            aria-label="显示右侧面板"
            checked={!layout.changesCollapsed}
            onChange={(visible) => updateLayout({ changesCollapsed: !visible })}
          />
        </div>
      </DialogCard>
      <p className="dlg-sub">
        <span>面板宽度</span>
        <small>窗口较小时自动适配</small>
      </p>
      <label className="dlg-fld">
        <span className="dlg-fld-label">
          <span>工作区宽度</span>
          <small>
            <output>{layout.sidebarWidth} px</output>
          </small>
        </span>
        <input
          type="range"
          aria-label="工作区宽度"
          className="dlg-range"
          style={fill(layout.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX)}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          // Adjusting a hidden panel would change nothing visible.
          disabled={layout.sidebarCollapsed}
          value={layout.sidebarWidth}
          onChange={(event) => updateLayout({ sidebarWidth: Number(event.target.value) })}
        />
      </label>
      <label className="dlg-fld">
        <span className="dlg-fld-label">
          <span>右侧面板宽度</span>
          <small>
            <output>{layout.changesWidth} px</output>
          </small>
        </span>
        <input
          type="range"
          aria-label="右侧面板宽度"
          className="dlg-range"
          style={fill(layout.changesWidth, CHANGES_MIN, CHANGES_MAX)}
          min={CHANGES_MIN}
          max={CHANGES_MAX}
          disabled={layout.changesCollapsed}
          value={layout.changesWidth}
          onChange={(event) => updateLayout({ changesWidth: Number(event.target.value) })}
        />
      </label>
      <p className="dlg-sub">
        <span>差异视图</span>
        <small>也可在差异工具栏切换</small>
      </p>
      <Segmented
        block
        aria-label="默认 Diff 模式"
        value={layout.diffMode}
        options={[
          { label: '统一', value: 'unified', icon: <DialogIcon name="file" /> },
          { label: '分栏', value: 'split', icon: <DialogIcon name="columns" /> },
        ]}
        onChange={(diffMode) => updateLayout({ diffMode: diffMode as 'unified' | 'split' })}
      />
    </AluneModal>
  );
}

export function LayoutSettingsContent() {
  const { layout, updateLayout, resetLayout } = useWorkspaceStore();
  return (
    <div className="layout-settings">
      <section className="layout-settings__section">
        <h2>侧边面板</h2>
        <p>独立显示或隐藏两侧面板，为差异阅读留出空间。</p>
        <div className="layout-settings__toggle">
          <span>
            显示左侧工作区<small>连接与仓库 · ⌘ / Ctrl B</small>
          </span>
          <Switch
            aria-label="显示左侧工作区"
            checked={!layout.sidebarCollapsed}
            onChange={(visible) => updateLayout({ sidebarCollapsed: !visible })}
          />
        </div>
        <div className="layout-settings__toggle">
          <span>
            显示右侧面板<small>改动、提交与历史 · ⌘ / Ctrl ⇧ B</small>
          </span>
          <Switch
            aria-label="显示右侧面板"
            checked={!layout.changesCollapsed}
            onChange={(visible) => updateLayout({ changesCollapsed: !visible })}
          />
        </div>
      </section>
      <section className="layout-settings__section">
        <h2>面板宽度</h2>
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
          右侧面板宽度 <output>{layout.changesWidth} px</output>
          <input
            type="range"
            aria-label="右侧面板宽度"
            min={CHANGES_MIN}
            max={CHANGES_MAX}
            value={layout.changesWidth}
            onChange={(event) => updateLayout({ changesWidth: Number(event.target.value) })}
          />
        </label>
      </section>
      <section className="layout-settings__section">
        <h2>差异视图</h2>
        <div className="layout-settings__toggle">
          <span>
            默认 Diff 模式<small>也可在差异工具栏随时切换</small>
          </span>
          <Segmented
            aria-label="默认 Diff 模式"
            value={layout.diffMode}
            options={[
              { label: '统一', value: 'unified' },
              { label: '分栏', value: 'split' },
            ]}
            onChange={(diffMode) => updateLayout({ diffMode: diffMode as 'unified' | 'split' })}
          />
        </div>
      </section>
      <Button onClick={resetLayout}>恢复默认布局</Button>
      <p>布局在此设备保存，恢复默认布局会保留工作区树的展开与排序设置。</p>
    </div>
  );
}
