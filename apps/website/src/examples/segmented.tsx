import { useState } from 'react';
import { Segmented } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState('列表');
  return (
    <>
      <Segmented
        aria-label="显示方式"
        value={value}
        onChange={setValue}
        options={['列表', '网格']}
      />
      <output aria-live="polite">当前：{value}</output>
    </>
  );
}
