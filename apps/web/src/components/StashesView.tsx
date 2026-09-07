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
      message.success(action === 'stashPop' ? '储藏已弹出' : action === 'stashApply' ? '储藏已应用' : '储藏已删除');
      await refresh();
    } catch (err: any) {
      message.error(err.message || '储藏操作失败');
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
      message.success('改动已储藏');
      await refresh();
    } catch (err: any) {
      message.error(err.message || '无法创建储藏');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="workspace-panel">
      <PanelHeader title="储藏" count={stashes.length} description="暂时保存改动，无需提交" icon={<InboxOutlined />} extra={<><Button type="text" icon={<ReloadOutlined />} aria-label="刷新储藏" onClick={() => void refresh()}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setStashModalVisible(true)}>储藏改动</Button></>} />
      {stashes.length === 0 ? <EmptyState title="暂无储藏" description="切换工作上下文时，可以使用储藏安全保存进行中的改动。" action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setStashModalVisible(true)}>储藏当前改动</Button>} /> : <div className="stash-list">
        {stashes.map((stash: any) => <article className="stash-card" key={stash.index}>
          <div className="stash-card__top"><InboxOutlined /><strong>stash@&#123;{stash.index}&#125;</strong>{stash.branch && <span className="stash-card__meta">位于 {stash.branch}</span>}</div>
          <div className="stash-card__message">{stash.message || '工作区快照'}</div>
          <div className="stash-card__meta">{formatRelativeDate(stash.date)} · 快照 {stash.index + 1}</div>
          <div className="stash-card__actions"><Button size="small" onClick={() => void runStashAction('stashApply', stash.index)} loading={loading}>应用</Button><Button size="small" type="primary" ghost onClick={() => void runStashAction('stashPop', stash.index)} loading={loading}>弹出</Button><Popconfirm title="删除此储藏？" description="此快照无法恢复。" onConfirm={() => void runStashAction('stashDrop', stash.index)}><Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除储藏 ${stash.index}`}>删除</Button></Popconfirm></div>
        </article>)}
      </div>}
      <Modal title="储藏当前改动" open={stashModalVisible} onCancel={() => setStashModalVisible(false)} onOk={() => void createStash()} confirmLoading={loading} okText="创建储藏">
        <Input autoFocus placeholder="可选备注" value={stashMessage} onChange={(event) => setStashMessage(event.target.value)} onPressEnter={() => void createStash()} />
      </Modal>
    </section>
  );
}
