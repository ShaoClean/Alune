import { useState } from 'react';
import { Input } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState('');
  return (
    <div className="example example--narrow">
      <label className="example-field">
        名称
        <Input
          aria-label="名称"
          placeholder="输入名称"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <label className="example-field">
        禁用状态
        <Input aria-label="禁用名称" disabled defaultValue="禁用" />
      </label>
      <label className="example-field">
        说明
        <Input.TextArea aria-label="说明" placeholder="多行说明" rows={3} />
      </label>
      <output className="example-status" aria-live="polite">
        当前输入：{value || '尚未填写'}
      </output>
    </div>
  );
}
