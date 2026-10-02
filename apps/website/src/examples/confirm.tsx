import { useState } from 'react';
import { Button, useAluneConfirm, DialogNote } from '@alune/ui';

export default function Example() {
  const confirm = useAluneConfirm();
  const [result, setResult] = useState('');
  return (
    <div className="example example--narrow">
      <h2 className="example-title">确认后更新本地状态</h2>
      <div className="example-row">
        <Button
          onClick={async () => {
            const accepted = await confirm({
              title: '继续本地示例？',
              level: 1,
              content: <DialogNote title="确认范围">只更新此页面状态。</DialogNote>,
            });
            setResult(accepted ? '已确认' : '已取消');
          }}
        >
          请求确认
        </Button>
      </div>
      <p className="example-status" role="status">
        {result}
      </p>
    </div>
  );
}
