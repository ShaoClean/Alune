import { useState } from 'react';
import { PanelHeader, PanelToggle } from '@alune/ui';

export default function Example() {
  const [expanded, setExpanded] = useState(true);
  return (
    <>
      <PanelHeader
        title="示例面板"
        count={3}
        description="可折叠的内容区域"
        extra={
          <PanelToggle
            side="right"
            expanded={expanded}
            controls="sample-panel"
            panelName="示例面板"
            onClick={() => setExpanded((v) => !v)}
          />
        }
      />
      <section id="sample-panel" hidden={!expanded} style={{ padding: 24 }}>
        面板内容
      </section>
    </>
  );
}
