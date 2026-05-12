import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Tag,
  message,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';

interface ConnectionFormValues {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey' | 'sshAgent';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export function ConnectionsPage() {
  const navigate = useNavigate();
  const { connections, loading, fetchConnections, addConnection, deleteConnection, testConnection } =
    useConnectionStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [testLoading, setTestLoading] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string }>>({});
  const [form] = Form.useForm<ConnectionFormValues>();

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleAdd = async (values: ConnectionFormValues) => {
    try {
      await addConnection(values);
      message.success('Connection added');
      setModalVisible(false);
      form.resetFields();
    } catch (err: any) {
      message.error(err.message || 'Failed to add connection');
    }
  };

  const handleTest = async (id: string) => {
    setTestLoading(id);
    try {
      const result = await testConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
      if (result.success) {
        message.success('Connection successful');
      } else {
        message.error(result.error || 'Connection failed');
      }
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setTestLoading(null);
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Host',
      dataIndex: 'host',
      key: 'host',
    },
    {
      title: 'Port',
      dataIndex: 'port',
      key: 'port',
    },
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: 'Auth',
      dataIndex: 'authType',
      key: 'authType',
      render: (type: string) => (
        <Tag color={type === 'password' ? 'blue' : type === 'privateKey' ? 'green' : 'orange'}>
          {type}
        </Tag>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: any, record: any) => {
        const result = testResults[record.id];
        if (result?.success) return <Tag icon={<CheckCircleOutlined />} color="success">Connected</Tag>;
        if (result?.success === false) return <Tag icon={<CloseCircleOutlined />} color="error">Failed</Tag>;
        return <Tag>Unknown</Tag>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space>
          <Button
            size="small"
            icon={<LinkOutlined />}
            loading={testLoading === record.id}
            onClick={() => handleTest(record.id)}
          >
            Test
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={() => navigate(`/repositories?connectionId=${record.id}`)}
          >
            Repos
          </Button>
          <Popconfirm title="Delete this connection?" onConfirm={() => deleteConnection(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="SSH Connections"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
            Add Connection
          </Button>
        }
      >
        <Table
          dataSource={connections}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      </Card>

      <Modal
        title="Add SSH Connection"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleAdd} initialValues={{ port: 22, authType: 'password' }}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="My Windows PC" />
          </Form.Item>
          <Form.Item name="host" label="Host" rules={[{ required: true, message: 'Please enter a host' }]}>
            <Input placeholder="192.168.1.100" />
          </Form.Item>
          <Form.Item name="port" label="Port" rules={[{ required: true }]}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input placeholder="user" />
          </Form.Item>
          <Form.Item name="authType" label="Authentication">
            <Select>
              <Select.Option value="password">Password</Select.Option>
              <Select.Option value="privateKey">Private Key</Select.Option>
              <Select.Option value="sshAgent">SSH Agent</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.authType !== cur.authType}>
            {({ getFieldValue }) =>
              getFieldValue('authType') === 'password' ? (
                <Form.Item name="password" label="Password">
                  <Input.Password />
                </Form.Item>
              ) : getFieldValue('authType') === 'privateKey' ? (
                <>
                  <Form.Item name="privateKeyPath" label="Private Key Path">
                    <Input placeholder="~/.ssh/id_rsa" />
                  </Form.Item>
                  <Form.Item name="passphrase" label="Passphrase">
                    <Input.Password />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}