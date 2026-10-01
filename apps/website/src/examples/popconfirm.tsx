import { useState } from 'react';
import { AlunePopconfirm, Button, Space } from '@alune/ui';

export default function Example() {
  const [result, setResult] = useState('');
  return (
    <>
      <Space wrap>
        {(['safe', 'warning', 'danger'] as const).map((tone) => (
          <AlunePopconfirm
            key={tone}
            title="移除此示例条目？"
            description="此操作只更新本地示例状态。"
            icon="folder"
            tone={tone}
            okText="移除"
            onConfirm={() => setResult(`${tone}：已移除`)}
          >
            <Button danger={tone !== 'safe'}>{tone}</Button>
          </AlunePopconfirm>
        ))}
      </Space>
      <p role="status">{result}</p>
    </>
  );
}
