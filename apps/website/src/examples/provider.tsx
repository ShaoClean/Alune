import { AluneUIProvider, Button, Space } from '@alune/ui';
import '@alune/ui/styles.css';

export default function Example({
  theme = 'light',
  reduceMotion = false,
}: {
  theme?: 'light' | 'dark';
  reduceMotion?: boolean;
}) {
  return (
    <AluneUIProvider theme={theme} reduceMotion={reduceMotion}>
      <div className="example example--narrow">
        <section className="example-group">
          <h2 className="example-title">主题中的控件</h2>
          <Space wrap size="middle">
            <Button type="primary">保存</Button>
            <Button>取消</Button>
          </Space>
        </section>
        <p className="example-status">
          主题：{theme} · 减少动效：{String(reduceMotion)}
        </p>
      </div>
    </AluneUIProvider>
  );
}
