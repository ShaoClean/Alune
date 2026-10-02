import { Dropdown, Button } from '@alune/ui';

export default function Example() {
  return (
    <div className="example example--narrow">
      <h2 className="example-title">点击打开操作菜单</h2>
      <div className="example-row">
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'copy', label: '复制' },
              { key: 'open', label: '打开' },
              { key: 'disabled', label: '不可用', disabled: true },
            ],
          }}
        >
          <Button>打开菜单</Button>
        </Dropdown>
      </div>
    </div>
  );
}
