import { useState } from 'react';
import { ToolbarButton, StatusButton, CommandButton, DialogIcon, Space } from '@alune/ui';

export default function Example() {
  const [active, setActive] = useState('files');
  const [count, setCount] = useState(0);
  return (
    <div className="example">
      <section className="example-group">
        <h2 className="example-title">视图切换</h2>
        <Space wrap size="middle">
          <ToolbarButton
            label="文件"
            active={active === 'files'}
            onClick={() => setActive('files')}
          >
            <DialogIcon name="folder" />
            文件
          </ToolbarButton>
          <ToolbarButton
            label="历史"
            active={active === 'history'}
            onClick={() => setActive('history')}
          >
            <DialogIcon name="clock" />
            历史
          </ToolbarButton>
        </Space>
      </section>
      <section className="example-group">
        <h2 className="example-title">操作与连接状态</h2>
        <Space wrap size="middle">
          <ToolbarButton label="运行示例" variant="primary" onClick={() => setCount((n) => n + 1)}>
            运行
          </ToolbarButton>
          <ToolbarButton label="不可用操作" variant="action" disabled>
            不可用
          </ToolbarButton>
          <StatusButton label="状态" active>
            已连接
          </StatusButton>
          <CommandButton label="刷新示例" onClick={() => setCount((n) => n + 1)}>
            <DialogIcon name="refresh" />
          </CommandButton>
        </Space>
      </section>
      <p className="example-status" role="status">
        当前：{active} · 操作次数：{count}
      </p>
    </div>
  );
}
