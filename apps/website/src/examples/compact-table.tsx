import { useState } from 'react';
import { Button, CompactTable } from '@alune/ui';
import type { CompactTableColumn, CompactTableGroup } from '@alune/ui';

type Item = { id: string; name: string; branch: string; path: string };
const groups: CompactTableGroup<Item>[] = [
  {
    key: 'local',
    label: '本机',
    items: [
      { id: 'local-app', name: '应用', branch: 'development', path: '~/Projects/app' },
      { id: 'local-docs', name: '文档', branch: 'docs/installation', path: '~/Projects/docs' },
    ],
  },
  {
    key: 'remote',
    label: '开发服务器',
    items: [
      {
        id: 'remote-app',
        name: '应用',
        branch: 'feature/workspace-repository-branch-overview',
        path: '/workspace/app',
      },
      { id: 'remote-api', name: '服务', branch: 'develop', path: '/workspace/api' },
    ],
  },
];
const columns: CompactTableColumn<Item>[] = [
  { key: 'name', title: '项目', width: 120, render: (item) => item.name },
  { key: 'branch', title: '分支', render: (item) => item.branch },
];

export default function Example() {
  const [selected, setSelected] = useState(groups[0].items[0]);
  const [opened, setOpened] = useState('');
  const [empty, setEmpty] = useState(false);
  return (
    <div className="example">
      <p className="example-title">单击或空格选择；↑ / ↓ / Home / End 移动，回车或双击执行打开。</p>
      <CompactTable
        label="项目分支"
        columns={columns}
        groups={empty ? [] : groups}
        rowKey={(item) => item.id}
        rowLabel={(item) => `${item.name} · ${item.path}`}
        selectedKey={selected.id}
        onSelect={setSelected}
        onActivate={(item) => setOpened(item.path)}
      />
      <p aria-live="polite">
        {empty ? '没有项目' : `所选路径：${selected.path}`}
        {opened && `；模拟打开：${opened}`}
      </p>
      <Button onClick={() => setEmpty((value) => !value)}>
        {empty ? '恢复数据' : '预览空状态'}
      </Button>
    </div>
  );
}
