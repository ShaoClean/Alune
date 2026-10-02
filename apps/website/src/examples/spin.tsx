import { Spin } from '@alune/ui';

export default function Example() {
  return (
    <div className="example">
      <section className="example-group">
        <h2 className="example-title">独立加载</h2>
        <div className="example-row">
          <Spin aria-label="正在加载" />
          <span>正在获取内容…</span>
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">内容加载</h2>
        <div className="example-panel">
          <Spin description="加载示例…">
            <div className="example-placeholder">等待中的内容</div>
          </Spin>
        </div>
      </section>
    </div>
  );
}
