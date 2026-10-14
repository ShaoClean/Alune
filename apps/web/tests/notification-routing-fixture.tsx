import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AluneUIProvider, Button } from '@alune/ui';
import { MemoryRouter } from 'react-router-dom';
import { FeedbackScope } from '../src/components/Feedback';
import { AluneModal } from '../src/components/AluneModal';
import { useFeedbackMessage } from '../src/components/useFeedbackMessage';
import { WorkspaceStatusBar } from '../src/components/WorkspaceStatusBar';
import { DesktopUpdateFeedback } from '../src/components/UpdatePanel';
import type { UpdateState } from '../src/types/desktop-updates';
import '@alune/ui/styles.css';
import '../src/index.css';
import '../src/theme.css';
import '../src/dialogs.css';
import '../src/workspace-layout.css';

declare global {
  interface Window {
    routing: {
      view?: ReturnType<typeof useFeedbackMessage>;
      setUpdate: (state: Partial<UpdateState> | null) => void;
      setWatching: (watching: boolean) => void;
    };
  }
}

function View() {
  const message = useFeedbackMessage();
  window.routing.view = message;
  return (
    <Button id="view-success" onClick={() => message.success('视图操作成功')}>
      视图操作
    </Button>
  );
}

function InsideForm() {
  const message = useFeedbackMessage();
  return (
    <Button id="form-inner" onClick={() => message.error('表单内操作失败')}>
      表单内操作
    </Button>
  );
}

function Fixture() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(true);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [watching, setWatching] = useState(false);
  const message = useFeedbackMessage();
  window.routing.setUpdate = (state) =>
    setUpdate(state && ({ supported: true, currentVersion: '1.0.0', ...state } as UpdateState));
  window.routing.setWatching = setWatching;
  return (
    <main style={{ padding: 24 }}>
      <Button id="open-form" onClick={() => setOpen(true)}>
        打开表单
      </Button>
      <Button id="toggle-view" onClick={() => setView((value) => !value)}>
        切换视图
      </Button>
      <FeedbackScope id="view" label="视图">
        {view && <View />}
      </FeedbackScope>
      <AluneModal
        title="表单"
        open={open}
        onCancel={() => setOpen(false)}
        okText="提交"
        onOk={async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          message.error('表单提交失败');
        }}
      >
        <InsideForm />
      </AluneModal>
      <DesktopUpdateFeedback
        state={update}
        error={null}
        invoke={async () => {}}
        onUpdates={() => {}}
        watching={watching}
      />
      <div style={{ position: 'fixed', inset: 'auto 0 0' }}>
        <WorkspaceStatusBar
          repositories={[]}
          version="v1.0.0"
          inert={false}
          onSettings={() => {}}
          onUpdates={() => {}}
        />
      </div>
    </main>
  );
}

window.routing = { setUpdate: () => {}, setWatching: () => {} };
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AluneUIProvider theme="dark" reduceMotion>
      <MemoryRouter>
        <Fixture />
      </MemoryRouter>
    </AluneUIProvider>
  </StrictMode>,
);
