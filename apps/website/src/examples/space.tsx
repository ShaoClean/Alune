import { Space, Button } from '@alune/ui';

export default function Example() {
  return (
    <div className="example">
      <h2 className="example-title">统一操作间距</h2>
      <div className="example-row">
        <Space wrap size="middle">
          <Button>第一个</Button>
          <Button>第二个</Button>
          <Button>第三个</Button>
        </Space>
      </div>
    </div>
  );
}
