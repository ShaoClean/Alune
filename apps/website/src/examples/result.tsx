import { useState } from 'react';
import { Result, Button } from '@alune/ui';

export default function Example() {
  const [reviewing, setReviewing] = useState(false);
  return reviewing ? (
    <>
      <p role="status">已返回本地检查步骤，请补充内容。</p>
      <Button onClick={() => setReviewing(false)}>重新查看结果</Button>
    </>
  ) : (
    <Result
      status="warning"
      title="部分内容未完成"
      subTitle="请检查输入后重试。"
      extra={<Button onClick={() => setReviewing(true)}>返回检查</Button>}
    />
  );
}
