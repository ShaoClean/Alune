import { useEffect } from 'react';
import { Table, Tag } from 'antd';
import { useRepositoryStore } from '../stores/repositoryStore';

interface Props {
  repoId: string;
}

export function HistoryView({ repoId }: Props) {
  const { log, loading, fetchLog } = useRepositoryStore();

  useEffect(() => {
    fetchLog(repoId);
  }, [repoId, fetchLog]);

  const columns = [
    {
      title: 'Hash',
      dataIndex: 'shortHash',
      key: 'shortHash',
      width: 80,
      render: (hash: string) => <Tag>{hash}</Tag>,
    },
    {
      title: 'Message',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
    },
    {
      title: 'Author',
      dataIndex: 'author',
      key: 'author',
      width: 150,
    },
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      width: 180,
      render: (date: string) => date ? new Date(date).toLocaleString() : '-',
    },
    {
      title: 'Refs',
      dataIndex: 'refs',
      key: 'refs',
      width: 200,
      render: (refs: string[]) =>
        refs?.map((ref) => (
          <Tag key={ref} color={ref === 'HEAD' ? 'red' : ref.startsWith('origin/') ? 'blue' : 'green'}>
            {ref}
          </Tag>
        )),
    },
  ];

  return (
    <div>
      <Table
        dataSource={log}
        columns={columns}
        rowKey="hash"
        size="small"
        loading={loading}
        pagination={{ pageSize: 50 }}
      />
    </div>
  );
}