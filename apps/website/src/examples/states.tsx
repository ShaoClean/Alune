import { useState } from 'react';
import { StatusBadge, RefBadge, EmptyState, LoadingState, ErrorState } from '@alune/ui';

export default function Example() {
  const [attempts, setAttempts] = useState(0);
  return (
    <div className="example">
      <section className="example-group">
        <h2 className="example-title">连接与工作区状态</h2>
        <div className="example-row">
          <StatusBadge status="connected" label="已连接" />
          <StatusBadge status="dirty" label="有更改" />
          <StatusBadge status="offline" label="离线" />
        </div>
        <div className="example-row">
          <RefBadge value="HEAD" />
          <RefBadge value="tag: v0.6.0" />
          <RefBadge value="origin/main" />
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">空内容</h2>
        <div className="example-panel">
          <EmptyState title="暂无记录" description="完成操作后显示内容。" />
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">加载中</h2>
        <div className="example-panel">
          <LoadingState label="正在加载示例…" />
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">失败与重试</h2>
        <div className="example-panel">
          <ErrorState
            title="示例加载失败"
            description="请重试"
            announce={false}
            onRetry={() => setAttempts((n) => n + 1)}
          />
        </div>
      </section>
      <p className="example-status" role="status">
        重试次数：{attempts}
      </p>
    </div>
  );
}
