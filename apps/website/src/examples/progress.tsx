import { Progress } from '@alune/ui';

export default function Example() {
  return (
    <div className="example">
      <section className="example-group">
        <h2 className="example-title">任务进度</h2>
        <div className="example-stack">
          <Progress percent={60} />
          <Progress percent={35} status="exception" />
          <Progress percent={100} />
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">环形进度</h2>
        <Progress type="circle" percent={72} size={80} />
      </section>
    </div>
  );
}
