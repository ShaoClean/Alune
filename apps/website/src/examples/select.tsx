import { useState } from 'react';
import { Select } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState('local');
  return (
    <div className="example example--narrow">
      <div className="example-field">
        <label htmlFor="sample-source">仓库来源</label>
        <Select
          id="sample-source"
          aria-label="来源"
          value={value}
          onChange={setValue}
          options={[
            { value: 'local', label: '本地' },
            { value: 'remote', label: '远程' },
            { value: 'disabled', label: '不可用', disabled: true },
          ]}
        />
      </div>
      <output className="example-status" aria-live="polite">
        当前来源：{value}
      </output>
    </div>
  );
}
