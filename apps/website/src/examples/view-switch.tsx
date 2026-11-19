import { useState } from 'react';
import { ViewSwitch } from '@alune/ui';

export default function Example() {
  const [view, setView] = useState('grid');
  return (
    <div className="example">
      <h2 className="example-title">仓库视图</h2>
      <ViewSwitch
        label="仓库视图"
        value={view}
        onChange={setView}
        options={[
          { value: 'grid', label: '卡片' },
          { value: 'list', label: '列表' },
          { value: 'overview', label: '数据总览' },
          { value: 'archived', label: '已归档', disabled: true },
        ]}
      />
    </div>
  );
}
