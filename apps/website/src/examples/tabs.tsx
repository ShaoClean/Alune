import { Tabs } from '@alune/ui';

export default function Example() {
  return (
    <Tabs
      defaultActiveKey="files"
      items={[
        { key: 'files', label: '文件', children: '文件内容' },
        { key: 'history', label: '历史', children: '历史内容' },
        { key: 'disabled', label: '禁用', disabled: true },
      ]}
    />
  );
}
