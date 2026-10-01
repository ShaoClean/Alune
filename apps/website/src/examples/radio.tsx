import { useState } from 'react';
import { Radio } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState('light');
  return (
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
  );
}
