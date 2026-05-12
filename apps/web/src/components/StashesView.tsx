import { useEffect } from 'react';
import { Table, Button, Space, message, Popconfirm } from 'antd';
import { useRepositoryStore } from '../stores/repositoryStore';
import { gitApi } from '../api';

interface Props {
  repoId: string;
  onRefresh: () => void;
}

export function StashesView({ repoId, onRefresh }: Props) {
  const { stashes, fetchStashes } = useRepositoryStore();

  useEffect(() => {
    fetchStashes(repoId);
  }, [repoId]);

  const handlePop = async (index?: number) => {
    try {
      await gitApi.stashPop(repoId, index);
      message.success('Stash popped');
      onRefresh();
      fetchStashes(repoId);
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleApply = async (index?: number) => {
    try {
      await gitApi.stashApply(repoId, index);
      message.success('Stash applied');
      onRefresh();
      fetchStashes(repoId);
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleDrop = async (index?: number) => {
    try {
      await gitApi.stashDrop(repoId, index);
      message.success('Stash dropped');
      fetchStashes(repoId);
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleStash = async () => {
    try {
      await gitApi.stash(repoId);
      message.success('Changes stashed');
      onRefresh();
      fetchStashes(repoId);
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const columns = [
    {
      title: 'Index',
      dataIndex: 'index',
      key: 'index',
      width: 60,
    },
    {
      title: 'Branch',
      dataIndex: 'branch',
      key: 'branch',
      width: 150,
    },
    {
      title: 'Message',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_: any, record: any) => (
        <Space>
          <Button size="small" onClick={() => handlePop(record.index)}>Pop</Button>
          <Button size="small" onClick={() => handleApply(record.index)}>Apply</Button>
          <Popconfirm title="Drop this stash?" onConfirm={() => handleDrop(record.index)}>
            <Button size="small" danger>Drop</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={handleStash}>Stash Current Changes</Button>
      </Space>

      <Table
        dataSource={stashes}
        columns={columns}
        rowKey="index"
        size="small"
        pagination={false}
      />
    </div>
  );
}