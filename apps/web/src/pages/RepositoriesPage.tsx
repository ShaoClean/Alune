import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Input,
  message,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SearchOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';

export function RepositoriesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const connectionId = searchParams.get('connectionId') || undefined;
  const { connections, fetchConnections } = useConnectionStore();
  const {
    repositories,
    loading,
    fetchRepositories,
    scanRepositories,
    addRepository,
    deleteRepository,
  } = useRepositoryStore();

  const [scanModalVisible, setScanModalVisible] = useState(false);
  const [scanPath, setScanPath] = useState('/home');
  const [scanResults, setScanResults] = useState<string[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [addingPath, setAddingPath] = useState<string | null>(null);

  useEffect(() => {
    fetchConnections();
    fetchRepositories(connectionId);
  }, [connectionId, fetchConnections, fetchRepositories]);

  const handleScan = async () => {
    if (!connectionId) {
      message.warning('Please select a connection first');
      return;
    }
    setScanLoading(true);
    try {
      const results = await scanRepositories(connectionId, scanPath);
      setScanResults(results);
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setScanLoading(false);
    }
  };

  const handleAdd = async (path: string) => {
    if (!connectionId) return;
    setAddingPath(path);
    try {
      await addRepository(connectionId, path);
      message.success('Repository added');
      fetchRepositories(connectionId);
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setAddingPath(null);
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: any) => (
        <Button type="link" onClick={() => navigate(`/repositories/${record.id}`)}>
          <FolderOutlined /> {name}
        </Button>
      ),
    },
    {
      title: 'Path',
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
    },
    {
      title: 'Branch',
      dataIndex: 'currentBranch',
      key: 'currentBranch',
      render: (branch: string) => branch && <Tag color="blue">{branch}</Tag>,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: any, record: any) => {
        if (record.isDirty === undefined) return <Tag>Unknown</Tag>;
        return record.isDirty ? <Tag color="warning">Dirty</Tag> : <Tag color="success">Clean</Tag>;
      },
    },
    {
      title: 'Ahead/Behind',
      key: 'aheadBehind',
      render: (_: any, record: any) => {
        const { ahead = 0, behind = 0 } = record;
        if (ahead === 0 && behind === 0) return '-';
        return (
          <Space size={4}>
            {ahead > 0 && <Tag color="green">↑{ahead}</Tag>}
            {behind > 0 && <Tag color="red">↓{behind}</Tag>}
          </Space>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space>
          <Popconfirm title="Remove this repository?" onConfirm={() => deleteRepository(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const connectionName = connections.find((c) => c.id === connectionId)?.name;

  return (
    <div>
      <Card
        title={
          connectionName ? `Repositories - ${connectionName}` : 'Repositories'
        }
        extra={
          <Space>
            <Button
              icon={<PlusOutlined />}
              onClick={() => setScanModalVisible(true)}
              disabled={!connectionId}
            >
              Scan &amp; Add
            </Button>
          </Space>
        }
      >
        <Table
          dataSource={repositories}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      </Card>

      <Modal
        title="Scan Remote Directories"
        open={scanModalVisible}
        onCancel={() => setScanModalVisible(false)}
        footer={null}
        width={700}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Input
              value={scanPath}
              onChange={(e) => setScanPath(e.target.value)}
              placeholder="Remote path to scan"
              style={{ width: 400 }}
            />
            <Button
              icon={<SearchOutlined />}
              loading={scanLoading}
              onClick={handleScan}
            >
              Scan
            </Button>
          </Space>
          {scanResults.length > 0 && (
            <div>
              {scanResults.map((path) => (
                <div
                  key={path}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <span>{path}</span>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    loading={addingPath === path}
                    onClick={() => handleAdd(path)}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
}