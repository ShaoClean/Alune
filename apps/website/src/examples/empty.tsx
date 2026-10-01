import { useState } from 'react';
import { Empty, Button } from '@alune/ui';

export default function Example() {
  const [created, setCreated] = useState(false);
  return created ? (
    <>
      <p role="status">已创建一条示例记录。</p>
      <Button onClick={() => setCreated(false)}>清空示例</Button>
    </>
  ) : (
    <Empty description="暂无记录">
      <Button type="primary" onClick={() => setCreated(true)}>
        创建示例记录
      </Button>
    </Empty>
  );
}
