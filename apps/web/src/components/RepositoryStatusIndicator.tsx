import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  QuestionCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useRepositoryStatus, useRepositoryVisibility } from '../hooks/useRepositoryStatus';
import { StatusBadge } from './ui';

export function RepositoryStatusIndicator({
  id,
  compact = false,
}: {
  id: string;
  compact?: boolean;
}) {
  const observe = useRepositoryVisibility(id);
  const { entry, stale } = useRepositoryStatus(id);
  const busy = entry?.phase === 'loading' || entry?.phase === 'queued';
  const failed = entry?.phase === 'error';
  const dirty = Boolean(entry?.data?.files.length);
  const label = busy
    ? entry?.data
      ? '更新中 · 缓存'
      : '状态加载中'
    : failed
      ? entry.data
        ? '更新失败 · 旧状态'
        : '状态失败'
      : !entry?.data
        ? '状态未更新'
        : stale
          ? dirty
            ? '有改动 · 已过期'
            : '干净 · 已过期'
          : dirty
            ? '有改动'
            : '干净';
  const updated =
    entry?.updatedAt === undefined
      ? ''
      : `更新于 ${new Date(entry.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`;
  const title = [label, updated, entry?.error].filter(Boolean).join(' · ');
  const Icon = busy
    ? LoadingOutlined
    : failed || stale
      ? WarningOutlined
      : !entry?.data
        ? QuestionCircleOutlined
        : dirty
          ? ClockCircleOutlined
          : CheckCircleOutlined;
  return (
    <span
      ref={observe}
      className={`repository-status${compact ? ' repository-status--compact' : ''}`}
      title={title}
      aria-label={title}
    >
      {compact ? (
        <Icon className={failed || stale || dirty ? 'repository-status--warning' : ''} />
      ) : (
        <>
          <StatusBadge
            status={
              failed
                ? 'error'
                : busy || !entry?.data
                  ? 'offline'
                  : stale || dirty
                    ? 'dirty'
                    : 'clean'
            }
            label={label}
          />
          {updated && <small>{updated}</small>}
        </>
      )}
    </span>
  );
}
