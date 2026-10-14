import { Button, MoonLoader } from '@alune/ui';

export default function Example() {
  return (
    <div className="example">
      <section className="example-group">
        <h2 className="example-title">尺寸</h2>
        <div className="example-row">
          <MoonLoader size="small" label="正在加载" />
          <MoonLoader size="default" label="正在加载" />
          <MoonLoader size="large" label="正在加载" />
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">行内与按钮</h2>
        <div className="example-row">
          <MoonLoader />
          <span>正在获取内容…</span>
          <Button loading>保存中</Button>
        </div>
      </section>
    </div>
  );
}
