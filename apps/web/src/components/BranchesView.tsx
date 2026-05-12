import { useEffect, useState } from 'react';
import { Table, Tag, Button, Space, Modal, Input, message, Popconfirm } from 'antd';
import {
  PlusOutlined,
  SwapOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { gitApi } from '../api';

interface Props {
  repoId: string;
  onRefresh: () => void;
}

export function BranchesView({ repoId, onRefresh }: Props) {
  const { branches, fetchBranches } = useRepositoryStore();
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchBranches(repoId);
  }, [repoId]);

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setLoading(true);
    try {
      await gitApi.createBranch(repoId, newBranchName, true);
      message.success(`Branch "${newBranchName}" created and switched to`);
      setCreateModalVisible(false);
      setNewBranchName('');
      onRefresh();
      fetchBranches(repoId);
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchBranch = async (name: string) => {
    setLoading(true);
    try {
      await gitApi.switchBranch(repoId, name);
      message.success(`Switched to "${name}"`);
      onRefresh();
      fetchBranches(repoId);
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBranch = async (name: string) => {
    setLoading(true);
    try {
      await gitApi.deleteBranch(repoId, name);
      message.success(`Branch "${name}" deleted`);
      fetchBranches(repoId);
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: 'Branch',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: any) => (
        <Space>
          {record.isCurrent && <Tag color="green">current</Tag>}
          <span style={{ fontWeight: record.isCurrent ? 'bold' : 'normal' }}>{name}</span>
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'isRemote',
      key: 'isRemote',
      render: (isRemote: boolean) => (
        <Tag color={isRemote ? 'blue' : 'green'}>{isRemote ? 'Remote' : 'Local'}</Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_: any, record: any) => (
        <Space>
          {!record.isCurrent && !record.isRemote && (
            <>
              <Button size="small" icon={<SwapOutlined />} onClick={() => handleSwitchBranch(record.name)}>
                Switch
              </Button>
              <Popconfirm
                title={`Delete branch "${record.name}"?`}
                onConfirm={() => handleDeleteBranch(record.name)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={() => fetchBranches(repoId)}>Refresh</Button>
        <Button icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>New Branch</Button>
      </Space>

      <Table
        dataSource={branches}
        columns={columns}
        rowKey="name"
        size="small"
        pagination={false}
      />

      <Modal
        title="Create Branch"
        open={createModalVisible}
        onOk={handleCreateBranch}
        onCancel={() => setCreateModalVisible(false)}
        confirmLoading={loading}
      >
        <Input
          placeholder="Branch name"
          value={newBranchName}
          onChange={(e) => setNewBranchName(e.target.value)}
        />
      </Modal>
    </div>
  );
}