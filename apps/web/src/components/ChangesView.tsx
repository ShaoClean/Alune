import { useState } from 'react';
import {
  Table,
  Button,
  Space,
  Input,
  Tag,
  message,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  MinusOutlined,
  SendOutlined,
  UndoOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { gitApi } from '../api';

interface Props {
  repoId: string;
  onRefresh: () => void;
}

const statusColors: Record<string, string> = {
  added: 'green',
  modified: 'orange',
  deleted: 'red',
  renamed: 'purple',
  untracked: 'default',
  ignored: 'default',
};

export function ChangesView({ repoId, onRefresh }: Props) {
  const { status, diff, fetchStatus, fetchDiff } = useRepositoryStore();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitDescription, setCommitDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const stagedFiles = status?.files?.filter((f: any) => f.staged) || [];
  const unstagedFiles = status?.files?.filter((f: any) => !f.staged) || [];

  const handleStage = async (files: string[]) => {
    setLoading(true);
    try {
      await gitApi.stage(repoId, files);
      await fetchStatus(repoId);
      message.success('Files staged');
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnstage = async (files: string[]) => {
    setLoading(true);
    try {
      await gitApi.unstage(repoId, files);
      await fetchStatus(repoId);
      message.success('Files unstaged');
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      message.warning('Please enter a commit message');
      return;
    }
    setLoading(true);
    try {
      await gitApi.commit(repoId, commitMessage, commitDescription || undefined);
      setCommitMessage('');
      setCommitDescription('');
      await fetchStatus(repoId);
      message.success('Committed successfully');
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileClick = async (file: string, staged: boolean) => {
    setSelectedFile(file);
    await fetchDiff(repoId, { file, staged });
  };

  const handlePush = async () => {
    setLoading(true);
    try {
      await gitApi.push(repoId);
      message.success('Push successful');
      onRefresh();
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePull = async () => {
    setLoading(true);
    try {
      await gitApi.pull(repoId);
      message.success('Pull successful');
      onRefresh();
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fileColumns = (isStaged: boolean) => [
    {
      title: 'File',
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
      render: (path: string) => (
        <a onClick={() => handleFileClick(path, isStaged)}>{path}</a>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={statusColors[status] || 'default'}>{status}</Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      render: (_: any, record: any) => (
        <Button
          size="small"
          icon={isStaged ? <MinusOutlined /> : <PlusOutlined />}
          onClick={() => isStaged ? handleUnstage([record.path]) : handleStage([record.path])}
        />
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={onRefresh}>Refresh</Button>
        <Button icon={<SendOutlined />} onClick={handlePush} loading={loading}>Push</Button>
        <Button icon={<UndoOutlined />} onClick={handlePull} loading={loading}>Pull</Button>
      </Space>

      {stagedFiles.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>Staged Changes ({stagedFiles.length})</strong>
            <Button size="small" onClick={() => handleUnstage(stagedFiles.map((f: any) => f.path))}>
              Unstage All
            </Button>
          </div>
          <Table
            dataSource={stagedFiles}
            columns={fileColumns(true)}
            rowKey="path"
            size="small"
            pagination={false}
          />
        </div>
      )}

      {unstagedFiles.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>Unstaged Changes ({unstagedFiles.length})</strong>
            <Button size="small" onClick={() => handleStage(unstagedFiles.map((f: any) => f.path))}>
              Stage All
            </Button>
          </div>
          <Table
            dataSource={unstagedFiles}
            columns={fileColumns(false)}
            rowKey="path"
            size="small"
            pagination={false}
          />
        </div>
      )}

      {stagedFiles.length > 0 && (
        <div style={{ marginBottom: 16, padding: 16, background: '#fafafa', borderRadius: 4 }}>
          <Input
            placeholder="Commit message"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <Input.TextArea
            placeholder="Description (optional)"
            value={commitDescription}
            onChange={(e) => setCommitDescription(e.target.value)}
            rows={3}
            style={{ marginBottom: 8 }}
          />
          <Popconfirm
            title="Are you sure you want to commit?"
            onConfirm={handleCommit}
          >
            <Button type="primary" loading={loading}>
              Commit
            </Button>
          </Popconfirm>
        </div>
      )}

      {selectedFile && diff && (
        <div style={{ marginTop: 16 }}>
          <strong>Diff: {selectedFile}</strong>
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, overflow: 'auto', maxHeight: 500 }}>
            {diff}
          </pre>
        </div>
      )}
    </div>
  );
}