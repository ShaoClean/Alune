import { useState } from 'react';
import { Segmented } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState('列表');
  return (
    <div className="example example--narrow">
      <div className="example-group">
        <h2 className="example-title">显示方式</h2>
        <Segmented
          aria-label="显示方式"
          value={value}
          onChange={setValue}
          options={['列表', '网格']}
        />
      </div>
      <output className="example-status" aria-live="polite">
        当前：{value}
      </output>
    </div>
  );
}
