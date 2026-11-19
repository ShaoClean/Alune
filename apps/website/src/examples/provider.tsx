import { useState } from 'react';
import { AluneUIProvider, Button, Popover, Space, Switch } from '@alune/ui';
import '@alune/ui/styles.css';

export default function Example({
  theme = 'light',
  reduceMotion = false,
}: {
  theme?: 'light' | 'dark';
  reduceMotion?: boolean;
}) {
  const [dark, setDark] = useState(theme === 'dark');
  return (
    <AluneUIProvider theme={dark ? 'dark' : 'light'} reduceMotion={reduceMotion}>
      <div className="example example--narrow">
        <h2 className="example-title">工作区外观</h2>
        <Space wrap>
          <Popover
            trigger="click"
            title="外观设置"
            content={
              <label className="example-setting">
                深色主题 <Switch aria-label="深色主题" checked={dark} onChange={setDark} />
              </label>
            }
          >
            <Button>打开外观设置</Button>
          </Popover>
          <Button type="primary">保存配置</Button>
        </Space>
      </div>
    </AluneUIProvider>
  );
}
