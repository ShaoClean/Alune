import { useState } from 'react';
import { Select } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState('local');
  return (
    <>
      <Select
        aria-label="来源"
        value={value}
        onChange={setValue}
        options={[
          { value: 'local', label: '本地' },
          { value: 'remote', label: '远程' },
          { value: 'disabled', label: '不可用', disabled: true },
        ]}
        style={{ width: 180 }}
      />
      <output aria-live="polite">{value}</output>
    </>
  );
}
