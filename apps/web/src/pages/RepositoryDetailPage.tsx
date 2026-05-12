import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, Spin, Descriptions, Button, Space } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { ChangesView } from '../components/ChangesView';
import { HistoryView } from '../components/HistoryView';
import { BranchesView } from '../components/BranchesView';
import { StashesView } from '../components/StashesView';

export function RepositoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentRepo,
    status,
    fetchStatus,
    fetchLog,
    fetchBranches,
    fetchStashes,
    setCurrentRepo,
  } = useRepositoryStore();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('changes');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const repo = { id } as any;
    setCurrentRepo(repo);
    Promise.all([
      fetchStatus(id),
      fetchLog(id),
      fetchBranches(id),
    ]).finally(() => setLoading(false));
  }, [id]);

  const handleRefresh = () => {
    if (!id) return;
    fetchStatus(id);
    if (activeTab === 'history') fetchLog(id);
    if (activeTab === 'branches') fetchBranches(id);
    if (activeTab === 'stashes') fetchStashes(id);
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/repositories')}>
          Back
        </Button>
      </Space>

      <Descriptions
        title={currentRepo?.name || 'Repository'}
        size="small"
        style={{ marginBottom: 16 }}
      >
        <Descriptions.Item label="Path">{currentRepo?.path}</Descriptions.Item>
        <Descriptions.Item label="Branch">
          {status?.branch || '-'}
        </Descriptions.Item>
        <Descriptions.Item label="Status">
          {status?.files?.length > 0 ? `${status.files.length} changes` : 'Clean'}
        </Descriptions.Item>
      </Descriptions>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'changes',
            label: `Changes${status?.files?.length ? ` (${status.files.length})` : ''}`,
            children: <ChangesView repoId={id!} onRefresh={handleRefresh} />,
          },
          {
            key: 'history',
            label: 'History',
            children: <HistoryView repoId={id!} />,
          },
          {
            key: 'branches',
            label: 'Branches',
            children: <BranchesView repoId={id!} onRefresh={handleRefresh} />,
          },
          {
            key: 'stashes',
            label: 'Stashes',
            children: <StashesView repoId={id!} onRefresh={handleRefresh} />,
          },
        ]}
      />
    </div>
  );
}