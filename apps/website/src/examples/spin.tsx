import { Spin } from '@alune/ui';

export default function Example() {
  return (
    <>
      <Spin aria-label="正在加载" />
      <Spin description="加载示例…">
        <div style={{ padding: 40 }}>等待中的内容</div>
      </Spin>
    </>
  );
}
