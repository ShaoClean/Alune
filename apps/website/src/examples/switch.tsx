import { useState } from 'react';
import { Switch } from '@alune/ui';

export default function Example() {
  const [checked, setChecked] = useState(false);
  return (
    <div className="example example--narrow">
      <section className="example-group">
        <h2 className="example-title">工作区设置</h2>
        <label className="example-setting">
          <span>自动保存</span>
          <Switch aria-label="启用自动保存" checked={checked} onChange={setChecked} />
        </label>
        <label className="example-setting">
          <span>禁用设置</span>
          <Switch aria-label="禁用设置" disabled />
        </label>
      </section>
      <output className="example-status" aria-live="polite">
        自动保存：{checked ? '启用' : '关闭'}
      </output>
    </div>
  );
}
