import { useState } from 'react';
import { Input } from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState('');
  return (
    <>
      <Input
        aria-label="名称"
        placeholder="输入名称"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Input aria-label="禁用名称" disabled defaultValue="禁用" />
      <Input.TextArea aria-label="说明" placeholder="多行说明" />
      <output aria-live="polite">{value}</output>
    </>
  );
}
