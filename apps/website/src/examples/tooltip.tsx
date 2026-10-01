import { Tooltip, Button } from '@alune/ui';

export default function Example() {
  return (
    <Tooltip title="保存当前配置" trigger={['hover', 'focus']}>
      <Button aria-label="保存当前配置">保存</Button>
    </Tooltip>
  );
}
