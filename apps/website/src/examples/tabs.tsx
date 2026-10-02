import { Tabs } from '@alune/ui';

export default function Example() {
  return (
    <div className="example">
      <h2 className="example-title">切换工作区内容</h2>
      <div className="example-stack">
        <Tabs
          defaultActiveKey="files"
          items={[
            {
              key: 'files',
              label: '文件',
              children: <div className="example-panel example-panel-body">文件内容</div>,
            },
            {
              key: 'history',
              label: '历史',
              children: <div className="example-panel example-panel-body">历史内容</div>,
            },
            { key: 'disabled', label: '禁用', disabled: true },
          ]}
        />
      </div>
    </div>
  );
}
