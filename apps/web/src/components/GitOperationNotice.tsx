import { useEffect, useRef, useState } from 'react';
import { App, Button } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { gitApi } from '../api';

const labels: Record<string, string> = {
  stage: '暂存',
  unstage: '取消暂存',
  commit: '提交',
  push: '推送',
  pull: '拉取',
  fetch: '获取远程更新',
  'fetch-history': '获取完整历史',
  merge: '合并分支',
  rebase: '变基',
  stash: '储藏',
  'stash-pop': '弹出储藏',
  'stash-apply': '应用储藏',
  'stash-drop': '删除储藏',
  'create-worktree': '创建 Worktree',
  'remove-worktree': '删除 Worktree',
  'delete-file': '删除文件',
};
export function GitOperationNotice({
  repoId,
  onFinished,
}: {
  repoId: string;
  onFinished: () => void;
}) {
  const { message } = App.useApp();
  const [operation, setOperation] = useState<{
    kind: string;
    startedAt: number;
    cancelling: boolean;
  } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const callback = useRef(onFinished);
  callback.current = onFinished;
  useEffect(() => {
    let stopped = false;
    let previous = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await gitApi.operation(repoId);
        if (stopped) return;
        setOperation(value);
        if (previous && !value) {
          setCancelling(false);
          callback.current();
        }
        previous = !!value;
      } catch {
        /* Operation polling must not replace the workspace's own error state. */
      }
      if (!stopped) timer = setTimeout(() => void read(), 1200);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [repoId]);
  if (!operation) return null;
  return (
    <div className="git-operation-notice" role="status">
      <LoadingOutlined />
      <span>
        {labels[operation.kind] || 'Git 操作'} ·{' '}
        {Math.max(1, Math.floor((Date.now() - operation.startedAt) / 1000))} 秒
      </span>
      <Button
        size="small"
        disabled={cancelling || operation.cancelling}
        onClick={async () => {
          setCancelling(true);
          try {
            await gitApi.cancel(repoId);
          } catch (error: any) {
            setCancelling(false);
            message.error(error.message);
          }
        }}
      >
        {cancelling || operation.cancelling ? '正在取消…' : '取消操作'}
      </Button>
      <small>取消后请刷新；已完成的步骤会保留。</small>
    </div>
  );
}
