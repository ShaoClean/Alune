import { useEffect, useRef, useState } from 'react';
import { Button, DialogIcon, Space } from '@alune/ui';

export default function Example() {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="example">
      <section className="example-group">
        <h2 className="example-title">操作与状态</h2>
        <Space wrap size="middle">
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
        </Space>
      </section>
      <section className="example-group">
        <h2 className="example-title">按钮尺寸</h2>
        <Space wrap size="middle" align="center">
          <Button size="small">小尺寸</Button>
          <Button>默认尺寸</Button>
          <Button size="large">大尺寸</Button>
        </Space>
      </section>
    </div>
  );
}
