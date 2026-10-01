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
      <Space wrap>
        <Button type="primary">保存</Button>
        <Button>取消</Button>
        <span>
          主题：{theme} · 减少动效：{String(reduceMotion)}
        </span>
      </Space>
    </AluneUIProvider>
  );
}
