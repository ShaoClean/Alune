import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFeedbackMessage, useAluneConfirm } from '@alune/ui';
import type { Repository, TerminalSession } from '@alune/domain';
import { terminalNeedsConfirmation } from '@alune/domain';
import {
  useTerminalStore,
  connectTerminals,
  closeTerminal,
  setTerminalPasteConfirmation,
} from '../stores/terminalStore';
import { registerTerminalRemovalConfirmation } from '../stores/terminalRemoval';
import { tabNumber, terminalName, type ViewSession } from '../stores/terminalState';
import { TerminalPanel } from './terminal/TerminalPanel';
import { TerminalPicker } from './terminal/TerminalPicker';
import '@xterm/xterm/css/xterm.css';
import '../terminal.css';

const closingDescription = '会话不可恢复，文件改动不会回滚。脱离会话的远端任务可能继续运行。';

export function TerminalWorkspace({
  slot,
  repository,
  switching,
}: {
  slot: HTMLDivElement | null;
  repository?: Repository | null;
  switching: boolean;
}) {
  const store = useTerminalStore();
  const [retained, setRetained] = useState(store.visible);
  useEffect(() => {
    if (store.visible) {
      setRetained(true);
      return;
    }
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.reduceMotion === 'true'
    ) {
      setRetained(false);
      return;
    }
    const timer = window.setTimeout(() => setRetained(false), 220);
    return () => window.clearTimeout(timer);
  }, [store.visible]);
  const confirm = useAluneConfirm();
  const feedback = useFeedbackMessage();
  useEffect(() => connectTerminals(feedback.info), [feedback]);
  useEffect(
    () =>
      window.aluneTerminal?.onShutdownRequested(async ({ requestId, sessions }) => {
        const confirmed = await confirm({
          level: 2,
          title: `关闭 ${sessions.length} 个终端并退出？`,
          description: closingDescription,
          content: <SessionSummary sessions={sessions} />,
          acknowledge: '我了解会话不可恢复，并确认关闭全部会话',
          okText: '关闭全部会话',
        });
        window.aluneTerminal?.respondToShutdown(requestId, confirmed);
      }),
    [confirm],
  );
  useEffect(() => {
    setTerminalPasteConfirmation((text) =>
      confirm({
        level: 1,
        title: '粘贴多行命令？',
        description: '粘贴内容可能立即执行，请先核对。',
        content: <pre className="terminal-paste-preview">{text}</pre>,
        okText: '粘贴',
        initialFocus: 'cancel',
      }),
    );
    registerTerminalRemovalConfirmation((sessions) =>
      confirm({
        level: 2,
        title: `关闭 ${sessions.length} 个终端并继续移除？`,
        description: closingDescription,
        content: <SessionSummary sessions={sessions} />,
        acknowledge: '我了解会话不可恢复，并确认关闭这些会话',
        okText: '关闭并继续移除',
      }),
    );
    return () => {
      setTerminalPasteConfirmation();
      registerTerminalRemovalConfirmation();
    };
  }, [confirm]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector('dialog:modal, .ant-modal-wrap:not([style*="display: none"])') ||
        !event.ctrlKey ||
        event.code !== 'Backquote'
      )
        return;
      event.preventDefault();
      useTerminalStore.getState().toggle();
      if (!useTerminalStore.getState().visible)
        document.querySelector<HTMLButtonElement>('[data-terminal-toggle]')?.focus();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (useTerminalStore.getState().sessions.some(terminalNeedsConfirmation)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('keydown', shortcut);
    // Electron confirms shutdown in the main process (also works after renderer failure).
    if (!window.aluneWorkspace) window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', shortcut);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  const close = async (session: TerminalSession) => {
    if (
      session.state === 'running' &&
      !(await confirm({
        level: 2,
        title: '关闭终端会话？',
        description: closingDescription,
        content: <SessionSummary sessions={[session]} />,
        acknowledge: '我了解会话不可恢复，并确认关闭',
        okText: '关闭会话',
      }))
    )
      return;
    try {
      await closeTerminal(session);
    } catch (error) {
      useTerminalStore.setState({ error: error instanceof Error ? error.message : '关闭失败。' });
    }
  };
  return (
    <>
      {slot &&
        (store.visible || retained) &&
        createPortal(
          <TerminalPanel
            key={repository?.id}
            repository={repository}
            switching={switching}
            onClose={close}
          />,
          slot,
        )}
      {store.allOpen && <TerminalPicker repositoryId={repository?.id} onClose={close} />}
    </>
  );
}

function SessionSummary({ sessions }: { sessions: ViewSession[] }) {
  return (
    <ul className="terminal-session-summary">
      {sessions.map((session) => (
        <li key={session.id}>
          <strong>
            {session.number && `${tabNumber(session)} · ${terminalName(session)} · `}
            {session.repositoryName} · {session.environment}
          </strong>
          <code>{session.initialPath}</code>
        </li>
      ))}
    </ul>
  );
}
