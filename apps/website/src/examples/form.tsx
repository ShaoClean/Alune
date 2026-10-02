import { useState } from 'react';
import { Form, Input, Button, Switch } from '@alune/ui';

export default function Example() {
  const [failure, setFailure] = useState(false);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="example example--narrow">
      <label className="example-row">
        <Switch aria-label="模拟提交失败" checked={failure} onChange={setFailure} /> 模拟失败
      </label>
      <Form
        layout="vertical"
        disabled={busy}
        onFinish={async (values) => {
          if (busy) return;
          setBusy(true);
          setResult('正在保存…');
          await new Promise((resolve) => setTimeout(resolve, 600));
          setResult(failure ? '保存失败，请保留输入并重试。' : `已保存：${values.name}`);
          setBusy(false);
        }}
      >
        <Form.Item
          name="name"
          label="配置名称"
          rules={[{ required: true, message: '请填写配置名称' }]}
          extra="名称仅在此示例中使用"
        >
          <Input />
        </Form.Item>
        <Form.Item name="description" label="说明">
          <Input.TextArea />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          保存配置
        </Button>
      </Form>
      <p className="example-status" role="status">
        {result}
      </p>
    </div>
  );
}
