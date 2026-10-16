import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button, Dropdown, FeedbackAlert } from '@alune/ui';
import type { MenuProps } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import { parsePatchHunks } from '@alune/shared';
import type { PartialDiffAction, PartialDiffSelection } from '@alune/shared';
import { gitApi } from '../api';

export type PartialDiffControls = {
  revision?: string;
  staged: boolean;
  unavailableReason?: string;
  refreshing?: boolean;
  preparing?: boolean;
  onEnable?: () => Promise<void>;
  onChanged: () => Promise<void>;
};

export function usePartialDiff(
  repoId: string | undefined,
  file: string | undefined,
  diff: string | undefined,
  controls: PartialDiffControls | undefined,
  loading: boolean,
) {
  const key = JSON.stringify([repoId, file, controls?.staged, controls?.revision, diff]);
  const current = useRef(key);
  current.current = key;
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PartialDiffSelection | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const hunks = useMemo(() => {
    if (!controls?.revision || !diff) return [];
    try {
      return parsePatchHunks(diff);
    } catch {
      return [];
    }
  }, [controls?.revision, diff]);
  const rows = useMemo(
    () => hunks.flatMap((h) => h.rows.filter((r) => r.kind !== 'context')),
    [hunks],
  );
  const changeIds = useMemo(() => new Set(rows.map((r) => r.index)), [rows]);
  const enabled = Boolean(repoId && file && controls?.revision && hunks.length);
  const disabled = busy || loading || !!controls?.refreshing || !!confirmation || !!failure;

  useEffect(() => {
    setSelected(new Set());
    anchor.current = undefined;
    setFailure(null);
    setConfirmation(null);
  }, [key]);
  useEffect(() => {
    if (confirmation) confirmRef.current?.focus();
  }, [confirmation]);

  const toggle = (index: number, range: boolean) => {
    if (disabled) return;
    const from = range && anchor.current !== undefined ? anchor.current : index;
    setSelected((previous) => {
      const next = new Set(previous);
      const checked = !previous.has(index);
      for (const id of changeIds) {
        if (id >= Math.min(from, index) && id <= Math.max(from, index)) {
          if (checked) next.add(id);
          else next.delete(id);
        }
      }
      return next;
    });
    anchor.current = index;
  };
  const execute = async (action: PartialDiffAction, selection: PartialDiffSelection) => {
    if (!enabled || !controls || pending.current) return;
    const origin = key;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    setConfirmation(null);
    try {
      await gitApi.partialDiff(repoId!, {
        file: file!,
        revision: controls.revision!,
        action,
        selection,
        ...(action === 'discard' ? { confirmed: true } : {}),
      });
      // Refresh the affected repository even if the user switched files while
      // the request was in flight. Store request IDs protect the visible diff.
      await controls.onChanged();
      if (current.current === origin) setSelected(new Set());
    } catch (error: any) {
      if (current.current === origin) setFailure(error.message || '操作失败，请刷新后重试。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const discard = (selection: PartialDiffSelection) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation(selection);
  };
  const cancel = () => {
    setConfirmation(null);
    requestAnimationFrame(
      () => trigger.current?.isConnected && trigger.current.focus({ preventScroll: true }),
    );
  };
  const onLineKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === ' ' && event.shiftKey) {
      event.preventDefault();
      toggle(index, true);
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const inputs = Array.from(
        event.currentTarget
          .closest('.diff-shell')!
          .querySelectorAll<HTMLInputElement>('input[data-partial-line]'),
      );
      const next =
        inputs[inputs.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
      next?.focus({ preventScroll: false });
    }
  };
  const lineSelector = (index: number | undefined, oldLine?: number, newLine?: number) => {
    if (!enabled) return null;
    if (index === undefined || !changeIds.has(index))
      return <span className="partial-line-spacer" />;
    return (
      <input
        type="checkbox"
        className="partial-line-checkbox"
        data-partial-line={index}
        aria-label={`选择${oldLine !== undefined ? `删除行 ${oldLine}` : `新增行 ${newLine}`}`}
        title="选择此行 · Shift 连选 · 空格切换"
        checked={selected.has(index)}
        disabled={disabled}
        onChange={(event) => toggle(index, !!(event.nativeEvent as MouseEvent).shiftKey)}
        onKeyDown={(event) => onLineKeyDown(event, index)}
      />
    );
  };
  const hunkActions = (headerIndex: number | undefined) => {
    if (!enabled) return null;
    const hunk = hunks.find((h) => h.headerIndex === headerIndex);
    if (!hunk) return null;
    const selection = { hunks: [hunk.index] };
    return (
      <span className="partial-hunk-actions" role="group" aria-label={`改动块 ${hunk.index + 1}`}>
        <Button
          size="small"
          disabled={disabled}
          onClick={() => void execute(controls!.staged ? 'unstage' : 'stage', selection)}
        >
          {controls!.staged ? '取消暂存此块' : '暂存此块'}
        </Button>
        {!controls!.staged && (
          <Button size="small" danger disabled={disabled} onClick={() => discard(selection)}>
            放弃此块
          </Button>
        )}
      </span>
    );
  };
  const clearSelection = () => {
    setSelected(new Set());
    anchor.current = undefined;
  };
  const applySelected = () =>
    void execute(controls!.staged ? 'unstage' : 'stage', { lines: [...selected] });
  const discardSelected = () => discard({ lines: [...selected] });
  const canEnable = !enabled && !controls?.refreshing && Boolean(controls?.onEnable);
  const working = busy || (!enabled && !!controls?.refreshing);
  const status = !enabled
    ? controls?.refreshing
      ? controls.preparing
        ? '正在准备按行操作…'
        : '正在刷新差异…'
      : controls?.unavailableReason
    : busy
      ? '正在应用改动…'
      : selected.size
        ? `已选择 ${selected.size} 行`
        : '勾选改动行 · Shift 连选';
  // Rendered inside the Diff header; narrow headers swap the buttons for `menu`.
  const toolbar =
    controls && (status || canEnable || enabled) ? (
      <div
        className="partial-diff-toolbar"
        role="group"
        aria-label="部分改动操作"
        aria-busy={working || undefined}
      >
        {status && (
          <span
            className={`partial-diff-hint${working ? ' partial-diff-hint--busy' : ''}`}
            role="status"
            title={status}
          >
            {status}
          </span>
        )}
        {canEnable && (
          <Button
            size="small"
            disabled={loading || busy}
            onClick={() => void controls.onEnable?.()}
          >
            开启按行操作
          </Button>
        )}
        {enabled && (
          <>
            <Button size="small" disabled={disabled || !selected.size} onClick={applySelected}>
              {controls.staged ? '取消暂存所选行' : '暂存所选行'}
            </Button>
            {!controls.staged && (
              <Button
                size="small"
                danger
                disabled={disabled || !selected.size}
                onClick={discardSelected}
              >
                放弃所选行
              </Button>
            )}
            {selected.size > 0 && (
              <Button size="small" type="text" disabled={disabled} onClick={clearSelection}>
                清除选择
              </Button>
            )}
          </>
        )}
      </div>
    ) : null;
  const menuItems: NonNullable<MenuProps['items']> = canEnable
    ? [{ key: 'enable', label: '开启按行操作', disabled: loading || busy }]
    : enabled
      ? [
          {
            key: 'apply',
            label: controls!.staged ? '取消暂存所选行' : '暂存所选行',
            disabled: disabled || !selected.size,
          },
          ...(!controls!.staged
            ? [
                {
                  key: 'discard',
                  label: '放弃所选行',
                  danger: true,
                  disabled: disabled || !selected.size,
                },
              ]
            : []),
          { key: 'clear', label: '清除选择', disabled: disabled || !selected.size },
        ]
      : [];
  const menu = menuItems.length ? (
    <Dropdown
      trigger={['click']}
      // Fullscreen Diff is a modal in the top layer; keep the menu inside it.
      getPopupContainer={(node) => node.closest('dialog') ?? document.body}
      menu={{
        items: status ? [{ type: 'group', label: status, children: menuItems }] : menuItems,
        onClick: ({ key }) => {
          if (key === 'enable') void controls?.onEnable?.();
          if (key === 'apply') applySelected();
          if (key === 'discard') discardSelected();
          if (key === 'clear') clearSelection();
        },
      }}
    >
      <Button
        className="partial-diff-more"
        type="text"
        size="small"
        icon={<EllipsisOutlined />}
        aria-label="更多按行操作"
        title={status ? `按行操作 · ${status}` : '按行操作'}
      />
    </Dropdown>
  ) : null;
  const refreshButton = (
    <Button
      size="small"
      disabled={busy || controls?.refreshing}
      onClick={async () => {
        try {
          await controls?.onChanged();
          if (current.current === key) setFailure(null);
        } catch (error: any) {
          if (current.current === key) setFailure(error.message || '无法刷新差异。');
        }
      }}
    >
      刷新差异
    </Button>
  );
  const feedback = (
    <>
      {confirmation && (
        <div
          className="partial-diff-confirm"
          role="alertdialog"
          aria-label="确认放弃改动"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
        >
          <span>
            放弃「{file}」的
            {confirmation.hunks
              ? `${confirmation.hunks.length} 个改动块`
              : `${confirmation.lines.length} 行改动`}
            ？此操作无法撤销，其他改动和暂存内容将保留。
          </span>
          <Button size="small" ref={confirmRef} onClick={cancel}>
            取消
          </Button>
          <Button size="small" danger onClick={() => void execute('discard', confirmation)}>
            确认放弃
          </Button>
        </div>
      )}
      {failure && (
        <div className="partial-diff-error">
          <FeedbackAlert
            source="partial-diff"
            context={file}
            type="error"
            title="改动未完成"
            description={failure}
            action={refreshButton}
          />
          {refreshButton}
        </div>
      )}
    </>
  );
  return { enabled, selected, toolbar, menu, feedback, lineSelector, hunkActions };
}
