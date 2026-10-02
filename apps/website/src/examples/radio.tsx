import { useState } from 'react';
import { Radio } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState('light');
  return (
    <div className="example example--narrow">
      <h2 className="example-title">选择配色主题</h2>
      <div className="example-row">
        <Radio.Group
          aria-label="主题"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          options={[
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
            { value: 'system', label: '跟随系统', disabled: true },
          ]}
        />
      </div>
    </div>
  );
}
