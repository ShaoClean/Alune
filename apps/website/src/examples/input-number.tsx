import { useState } from 'react';
import { InputNumber } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState<number | null>(3);
  return (
    <div className="example example--narrow">
      <div className="example-group">
        <label className="example-title" htmlFor="sample-quantity">
          数量 · 0–10
        </label>
        <InputNumber
          id="sample-quantity"
          aria-label="数量"
          min={0}
          max={10}
          value={value}
          onChange={setValue}
        />
      </div>
      <output className="example-status" aria-live="polite">
        数量：{value ?? '未填写'}
      </output>
    </div>
  );
}
