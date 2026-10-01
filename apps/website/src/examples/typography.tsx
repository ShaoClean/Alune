import { Typography } from '@alune/ui';

export default function Example() {
  return (
    <>
      <Typography.Title level={3}>清晰的内容层级</Typography.Title>
      <Typography.Paragraph>说明文字使用语义化段落，并保持可读对比度。</Typography.Paragraph>
      <Typography.Text type="secondary">辅助说明</Typography.Text>{' '}
      <Typography.Text code>main</Typography.Text>
    </>
  );
}
