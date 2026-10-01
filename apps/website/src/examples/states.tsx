import { useState } from 'react';
import { StatusBadge, RefBadge, EmptyState, LoadingState, ErrorState, Space } from '@alune/ui';

export default function Example() {
  const [attempts, setAttempts] = useState(0);
  return (
    <>
      <Space wrap>
        <StatusBadge status="connected" label="已连接" />
        <StatusBadge status="dirty" label="有更改" />
        <StatusBadge status="offline" label="离线" />
        <RefBadge value="HEAD" />
        <RefBadge value="tag: v0.6.0" />
        <RefBadge value="origin/main" />
      </Space>
      <EmptyState title="暂无记录" description="完成操作后显示内容。" />
      <LoadingState label="正在加载示例…" />
      <ErrorState
        title="示例加载失败"
        description="请重试"
        announce={false}
        onRetry={() => setAttempts((n) => n + 1)}
      />
      <p role="status">重试次数：{attempts}</p>
    </>
  );
}
