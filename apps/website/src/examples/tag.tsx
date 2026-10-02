import { Tag } from '@alune/ui';

export default function Example() {
  return (
    <div className="example">
      <h2 className="example-title">语义标签与关闭操作</h2>
      <div className="example-row">
        <Tag>默认</Tag>
        <Tag color="success">已完成</Tag>
        <Tag color="warning">等待</Tag>
        <Tag color="error">失败</Tag>
        <Tag closable>可关闭</Tag>
      </div>
    </div>
  );
}
