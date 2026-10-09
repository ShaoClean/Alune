import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Segmented, Switch } from '@alune/ui';
import { FileOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import {
  historyFilterActive,
  useRepositoryStore,
  useWorkspaceData,
} from '../stores/repositoryStore';
import type { HistoryFilter } from '../stores/repositoryStore';
import { draftFilter, toDraft } from './history-filter';
import type { Draft } from './history-filter';

const DEBOUNCE_MS = 400;
const key = (filter: HistoryFilter) =>
  JSON.stringify(
    Object.entries(filter)
      .filter(([, value]) => value !== undefined && value !== '' && value !== false)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
const same = (a: HistoryFilter, b: HistoryFilter) => key(a) === key(b);

export function HistoryFilterBar({ repoId, actions }: { repoId: string; actions?: ReactNode }) {
  const logFilter = useWorkspaceData(repoId, (workspace) => workspace.logFilter);
  const setLogFilter = useRepositoryStore((state) => state.setLogFilter);
  const [draft, setDraft] = useState(() => toDraft(logFilter));
  const applied = useRef(logFilter);
  // A filter set elsewhere (file history, a jump to one commit) replaces the draft.
  useEffect(() => {
    if (same(logFilter, applied.current)) return;
    applied.current = logFilter;
    setDraft(toDraft(logFilter));
  }, [logFilter]);
  const next = draftFilter(draft);
  const pending = !same(next, applied.current);
  const invalidRange = !!next.since && !!next.until && next.since > next.until;
  const apply = (filter: HistoryFilter) => {
    if (same(filter, applied.current)) return;
    applied.current = filter;
    void setLogFilter(repoId, filter);
  };
  // Typing waits for a pause; dates, scope and rename tracking apply at once.
  useEffect(() => {
    if (!pending || invalidRange) return;
    const timer = setTimeout(() => apply(next), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [JSON.stringify(next)]);
  const update = (patch: Partial<Draft>, immediate = false) => {
    const value = { ...draft, ...patch };
    setDraft(value);
    const filter = draftFilter(value);
    if (immediate && !(filter.since && filter.until && filter.since > filter.until)) apply(filter);
  };
  const submit = () => {
    if (!invalidRange) apply(next);
  };
  const active = historyFilterActive(next);

  return (
    <div className="history-filter" role="search" aria-label="筛选提交历史">
      <Input
        className="history-filter__search"
        aria-label="搜索提交信息或哈希"
        placeholder="搜索提交信息或哈希"
        prefix={<SearchOutlined />}
        allowClear
        size="small"
        value={draft.search}
        onChange={(event) => update({ search: event.target.value })}
        onPressEnter={submit}
      />
      <Input
        className="history-filter__author"
        aria-label="按作者筛选"
        placeholder="作者"
        prefix={<UserOutlined />}
        allowClear
        size="small"
        value={draft.author}
        onChange={(event) => update({ author: event.target.value })}
        onPressEnter={submit}
      />
      <span className="history-filter__dates" role="group" aria-label="提交时间范围">
        <Input
          type="date"
          size="small"
          aria-label="开始日期"
          status={invalidRange ? 'error' : undefined}
          value={draft.since}
          max={draft.until || undefined}
          onChange={(event) => update({ since: event.target.value }, true)}
        />
        <span aria-hidden="true">–</span>
        <Input
          type="date"
          size="small"
          aria-label="结束日期"
          status={invalidRange ? 'error' : undefined}
          value={draft.until}
          min={draft.since || undefined}
          onChange={(event) => update({ until: event.target.value }, true)}
        />
      </span>
      <Input
        className="history-filter__path"
        aria-label="按文件或目录路径筛选"
        placeholder="文件或目录路径"
        prefix={<FileOutlined />}
        allowClear
        size="small"
        spellCheck={false}
        value={draft.file}
        onChange={(event) => update({ file: event.target.value })}
        onPressEnter={submit}
      />
      <label className="history-filter__follow" title="仅适用于单个文件">
        <Switch
          size="small"
          checked={draft.follow}
          disabled={!draft.file.trim()}
          onChange={(follow) => update({ follow }, true)}
        />
        跟踪重命名
      </label>
      <Segmented
        size="small"
        aria-label="分支范围"
        value={draft.currentBranch ? 'current' : 'all'}
        options={[
          { label: '全部分支', value: 'all' },
          { label: '当前分支', value: 'current' },
        ]}
        onChange={(value) => update({ currentBranch: value === 'current' }, true)}
      />
      {active && (
        <Button
          size="small"
          type="text"
          onClick={() => {
            setDraft(toDraft({}));
            apply({});
          }}
        >
          清除筛选
        </Button>
      )}
      {invalidRange && (
        <span className="history-filter__error" role="alert">
          开始日期不能晚于结束日期
        </span>
      )}
      {actions && <span className="history-filter__actions">{actions}</span>}
    </div>
  );
}
