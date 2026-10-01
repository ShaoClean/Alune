import { useState } from 'react';
import { InputNumber } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState<number | null>(3);
  return (
    <>
      <InputNumber aria-label="数量" min={0} max={10} value={value} onChange={setValue} />
      <output aria-live="polite">数量：{value ?? '未填写'}</output>
    </>
  );
}
