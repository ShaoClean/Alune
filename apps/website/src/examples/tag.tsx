import { Tag } from '@alune/ui';

export default function Example() {
  return (
    <>
      <Tag>默认</Tag>
      <Tag color="success">已完成</Tag>
      <Tag color="warning">等待</Tag>
      <Tag color="error">失败</Tag>
      <Tag closable>可关闭</Tag>
    </>
  );
}
