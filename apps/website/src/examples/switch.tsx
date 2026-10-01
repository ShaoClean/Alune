import { useState } from 'react';
import { Switch } from '@alune/ui';

export default function Example() {
  const [checked, setChecked] = useState(false);
  return (
    <>
      <Switch aria-label="启用自动保存" checked={checked} onChange={setChecked} />
      <span>自动保存：{checked ? '启用' : '关闭'}</span>
      <Switch aria-label="禁用设置" disabled />
    </>
  );
}
