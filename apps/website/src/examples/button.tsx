import { useEffect, useRef, useState } from 'react';
import { Button, DialogIcon, Space } from '@alune/ui';

export default function Example() {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Space wrap>
      <Button
        type="primary"
        loading={busy}
        icon={<DialogIcon name="check" />}
        onClick={() => {
          setBusy(true);
          timer.current = setTimeout(() => setBusy(false), 700);
        }}
      >
        保存
      </Button>
      <Button>默认</Button>
      <Button type="text">文字</Button>
      <Button danger>危险</Button>
      <Button disabled>禁用</Button>
      <Button size="small">小尺寸</Button>
      <Button size="large">大尺寸</Button>
    </Space>
  );
}
