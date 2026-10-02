import { Tooltip, Button } from '@alune/ui';

export default function Example() {
  return (
    <div className="example example--narrow">
      <h2 className="example-title">悬停或聚焦查看提示</h2>
      <div className="example-row">
        <Tooltip title="保存当前配置" trigger={['hover', 'focus']}>
          <Button aria-label="保存当前配置">保存</Button>
        </Tooltip>
      </div>
    </div>
  );
}
