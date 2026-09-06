import { useEffect, useState } from 'react';
import { Button, Input, Modal, Popconfirm, message } from 'antd';
import { DeleteOutlined, InboxOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { gitApi } from '../api';
import { EmptyState, formatRelativeDate, PanelHeader } from './ui';

interface Props {
  repoId: string;
  onRefresh: () => void;
}

export function StashesView({ repoId, onRefresh }: Props) {
  const { stashes, fetchStashes } = useRepositoryStore();
  const [loading, setLoading] = useState(false);
  const [stashModalVisible, setStashModalVisible] = useState(false);
  const [stashMessage, setStashMessage] = useState('');

  useEffect(() => {
    void fetchStashes(repoId);
  }, [repoId, fetchStashes]);

  const refresh = async () => {
    await fetchStashes(repoId);
    onRefresh();
  };

  const runStashAction = async (action: 'stashPop' | 'stashApply' | 'stashDrop', index: number) => {
    setLoading(true);
    try {
      await gitApi[action](repoId, index);
      message.success(action === 'stashPop' ? 'Stash popped' : action === 'stashApply' ? 'Stash applied' : 'Stash dropped');
      await refresh();
    } catch (err: any) {
      message.error(err.message || 'Stash operation failed');
    } finally {
      setLoading(false);
    }
  };

  const createStash = async () => {
    setLoading(true);
    try {
      await gitApi.stash(repoId, stashMessage.trim() || undefined);
      setStashMessage('');
      setStashModalVisible(false);
      message.success('Changes stashed');
      await refresh();
    } catch (err: any) {
      message.error(err.message || 'Unable to create stash');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="workspace-panel">
      <PanelHeader title="Stashes" count={stashes.length} description="Temporarily shelve work without committing" icon={<InboxOutlined />} extra={<><Button type="text" icon={<ReloadOutlined />} aria-label="Refresh stashes" onClick={() => void refresh()}>Refresh</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setStashModalVisible(true)}>Stash changes</Button></>} />
      {stashes.length === 0 ? <EmptyState title="No stashes" description="A stash is a safe place to put work in progress while you switch context." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setStashModalVisible(true)}>Stash current changes</Button>} /> : <div className="stash-list">
        {stashes.map((stash: any) => <article className="stash-card" key={stash.index}>
          <div className="stash-card__top"><InboxOutlined /><strong>stash@&#123;{stash.index}&#125;</strong>{stash.branch && <span className="stash-card__meta">on {stash.branch}</span>}</div>
          <div className="stash-card__message">{stash.message || 'Working tree snapshot'}</div>
          <div className="stash-card__meta">{formatRelativeDate(stash.date)} · Snapshot {stash.index + 1}</div>
          <div className="stash-card__actions"><Button size="small" onClick={() => void runStashAction('stashApply', stash.index)} loading={loading}>Apply</Button><Button size="small" type="primary" ghost onClick={() => void runStashAction('stashPop', stash.index)} loading={loading}>Pop</Button><Popconfirm title="Drop this stash?" description="This snapshot cannot be recovered." onConfirm={() => void runStashAction('stashDrop', stash.index)}><Button size="small" danger icon={<DeleteOutlined />} aria-label={`Drop stash ${stash.index}`}>Drop</Button></Popconfirm></div>
        </article>)}
      </div>}
      <Modal title="Stash current changes" open={stashModalVisible} onCancel={() => setStashModalVisible(false)} onOk={() => void createStash()} confirmLoading={loading} okText="Create stash">
        <Input autoFocus placeholder="Optional message" value={stashMessage} onChange={(event) => setStashMessage(event.target.value)} onPressEnter={() => void createStash()} />
      </Modal>
    </section>
  );
}
