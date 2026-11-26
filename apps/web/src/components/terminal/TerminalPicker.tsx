import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AluneModal, Button } from '@alune/ui';
import { BrandIcon } from '../BrandIcon';
import { getTerminalRuntime } from '../../stores/terminalStore';
import {
  terminalName,
  terminalStateLabel,
  tabNumber,
  useTerminalStore,
  type ViewSession,
} from '../../stores/terminalState';
import { useRepositoryStore } from '../../stores/repositoryStore';

function OutputPreview({ session }: { session: ViewSession }) {
  const runtime = getTerminalRuntime(session.id);
  const read = () => {
    const buffer = runtime?.terminal.buffer.active;
    if (!buffer) return '';
    const lines: string[] = [];
    for (
      let i = buffer.length - 1;
      i >= Math.max(0, buffer.length - 200) && lines.length < 8;
      i--
    ) {
      const line = buffer.getLine(i)?.translateToString(true).slice(-512) || '';
      if (line || lines.length) lines.unshift(line);
    }
    return lines.join('\n');
  };
  const [text, setText] = useState(read);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    setText(read());
    const sub = runtime?.terminal.onWriteParsed(() => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          setText(read());
        }, 150);
    });
    return () => {
      sub?.dispose();
      clearTimeout(timer);
    };
  }, [runtime]);
  return (
    <div className="terminal-preview">
      <strong>最近输出</strong>
      <pre tabIndex={0}>{text || session.error || '暂无输出'}</pre>
    </div>
  );
}

export function TerminalPicker({
  repositoryId,
  onClose,
}: {
  repositoryId?: string;
  onClose: (s: ViewSession) => Promise<void>;
}) {
  const store = useTerminalStore();
  const navigate = useNavigate();
  const [id, setId] = useState(store.selected[repositoryId || '']);
  const selected = store.sessions.find((s) => s.id === id) || store.sessions[0];
  const groups = new Map<string, ViewSession[]>();
  for (const s of store.sessions) {
    const group = groups.get(s.repositoryId) || [];
    group.push(s);
    groups.set(s.repositoryId, group);
  }
  const enter = () => {
    if (!selected) return;
    const repos = useRepositoryStore.getState();
    const repo = repos.repositories.find((r) => r.id === selected.repositoryId);
    if (!repo) {
      useTerminalStore.setState({ error: '仓库登记已移除，请关闭此终端记录。' });
      return;
    }
    repos.openRepository(repo);
    store.select(selected);
    useTerminalStore.setState({ allOpen: false });
    navigate('/repositories/' + repo.id);
  };
  return (
    <AluneModal
      open
      title="全部终端会话"
      glyph={<BrandIcon className="terminal-brand" />}
      size={700}
      body="flush"
      footer={null}
      onCancel={() => useTerminalStore.setState({ allOpen: false })}
    >
      {selected ? (
        <div className="terminal-picker">
          <div className="terminal-picker-list">
            {[...groups].map(([repo, list]) => (
              <section key={repo}>
                <strong className="terminal-picker-repo">
                  {list[0].repositoryName}
                  <small>{list.length}</small>
                </strong>
                <ul className="terminal-all-sessions">
                  {list.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-pressed={s.id === selected.id}
                        onClick={() => setId(s.id)}
                        onKeyDown={(event) => {
                          const buttons = Array.from(
                            event.currentTarget
                              .closest('.terminal-picker-list')!
                              .querySelectorAll('button'),
                          );
                          const i = buttons.indexOf(event.currentTarget);
                          const delta = ['ArrowRight', 'ArrowDown'].includes(event.key)
                            ? 1
                            : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                              ? -1
                              : 0;
                          if (!delta) return;
                          event.preventDefault();
                          const next = buttons[(i + delta + buttons.length) % buttons.length];
                          next.click();
                          next.focus();
                        }}
                      >
                        <span className={'terminal-dot is-' + s.state} />
                        <span className="terminal-picker-label">
                          <strong>
                            {tabNumber(s)} · {terminalName(s)}
                          </strong>
                          <small>
                            {s.title && s.title !== terminalName(s) ? s.title : s.environment}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <section className="terminal-picker-detail">
            <div className="terminal-picker-heading">
              <strong>{terminalName(selected)}</strong>
              <span className="terminal-state">{terminalStateLabel(selected)}</span>
            </div>
            <div className="terminal-identity">
              <span title={selected.environment}>{selected.environment}</span> ·{' '}
              <code>{selected.initialPath}</code>
            </div>
            <OutputPreview key={selected.id} session={selected} />
            <div className="terminal-picker-actions">
              <Button type="text" onClick={() => void onClose(selected)} aria-label="关闭所选会话">
                关闭会话…
              </Button>
              <Button type="primary" onClick={enter}>
                进入会话
              </Button>
            </div>
          </section>
        </div>
      ) : (
        <p className="terminal-picker-empty">当前没有终端会话</p>
      )}
      {store.error && (
        <div className="terminal-notice" role="status">
          {store.error}
        </div>
      )}
    </AluneModal>
  );
}
