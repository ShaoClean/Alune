import { Popover, Button } from '@alune/ui';

export default function Example() {
  return (
    <Popover title="预览详情" content="浮层位于示例文档内。" trigger="click">
      <Button>查看详情</Button>
    </Popover>
  );
}
