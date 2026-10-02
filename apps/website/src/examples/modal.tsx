import { useState } from 'react';
import { AluneModal, Button, Input, Radio, Switch, DialogNote } from '@alune/ui';

export default function Example() {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const [failure, setFailure] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  return (
    <div className="example example--narrow">
      <h2 className="example-title">风险等级与提交状态</h2>
      <Radio.Group
        aria-label="风险等级"
        value={level}
        onChange={(e) => setLevel(e.target.value)}
        options={[0, 1, 2].map((value) => ({ value, label: `L${value}` }))}
      />
      <label className="example-row">
        <Switch aria-label="模拟异步失败" checked={failure} onChange={setFailure} /> 模拟异步失败
      </label>
      <div className="example-row">
        <Button
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          打开弹窗
        </Button>
      </div>
      <p className="example-status" role="status">
        {result}
      </p>
      <AluneModal
        open={open}
        title={level === 2 ? '放弃示例更改？' : '保存示例配置'}
        level={level}
        size="md"
        okText={level === 2 ? '放弃更改' : '保存配置'}
        description="只操作本地模拟状态。"
        typedConfirm={level === 2 ? { value: 'main', label: '输入 main 确认' } : undefined}
        acknowledge={level === 2 ? '我了解此操作无法撤销' : undefined}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (failure) {
            setError('保存失败，输入已保留。');
            throw new Error('模拟失败');
          }
          setResult('操作已完成');
          setOpen(false);
        }}
      >
        <Input aria-label="配置名称" defaultValue="示例配置" />
        {error && (
          <DialogNote tone="danger" title="提交失败">
            {error}
          </DialogNote>
        )}
      </AluneModal>
    </div>
  );
}
