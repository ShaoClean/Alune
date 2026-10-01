import { useState } from 'react';
import {
  DialogCard,
  DialogPath,
  RepoRow,
  DialogStats,
  DialogStat,
  DialogLedger,
  DialogNote,
  DialogEmpty,
  DialogProgress,
  OptionCards,
  DialogHints,
  Kbd,
  CheckCard,
} from '@alune/ui';

export default function Example() {
  const [value, setValue] = useState<'safe' | 'fast'>('safe');
  const [checked, setChecked] = useState(false);
  return (
    <>
      <DialogCard pad>
        <RepoRow name="示例项目" path="/example/alune" />
        <DialogPath path="src/components/Example.tsx" />
        <DialogStats>
          <DialogStat value={3} label="文件" tone="info" />
          <DialogStat value={0} label="失败" off />
        </DialogStats>
      </DialogCard>
      <DialogLedger
        change={[{ icon: 'x', text: '示例草稿' }]}
        keep={[{ icon: 'check', text: '已保存内容' }]}
      />
      <DialogNote title="说明" tone="warning">
        静态后果说明在确认前始终可见。
      </DialogNote>
      <DialogEmpty>暂无选项</DialogEmpty>
      <DialogProgress value={0.6} label="已完成 60%" />
      <OptionCards
        label="处理方式"
        value={value}
        onChange={setValue}
        options={[
          { value: 'safe', title: '安全检查', description: '先核对结果' },
          { value: 'fast', title: '快速执行', description: '适用于模拟数据' },
        ]}
      />
      <CheckCard
        checked={checked}
        onChange={setChecked}
        title="我已核对操作范围"
        description="勾选只改变此示例状态"
      />
      <DialogHints>
        <Kbd>Esc</Kbd> 取消
      </DialogHints>
    </>
  );
}
