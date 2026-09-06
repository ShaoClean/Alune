import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  message,
} from 'antd';
import {
  ApartmentOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';
import { EmptyState, LoadingState, StatusBadge } from '../components/ui';

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
  const { connections, loading, fetchConnections, addConnection, deleteConnection, testConnection } = useConnectionStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [testLoading, setTestLoading] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string }>>({});
  const [form] = Form.useForm<ConnectionFormValues>();

  useEffect(() => {
    void fetchConnections();
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
      setTestResults((previous) => ({ ...previous, [id]: result }));
      if (result.success) message.success('Connection successful');
      else message.error(result.error || 'Connection failed');
    } catch (err: any) {
      message.error(err.message || 'Connection failed');
    } finally {
      setTestLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConnection(id);
      message.success('Connection removed');
    } catch (err: any) {
      message.error(err.message || 'Failed to remove connection');
    }
  };

  return (
    <div>
      <div className="page-heading">
        <div>
          <h2>Connections</h2>
          <p>Manage the SSH workspaces that power your remote repositories.</p>
        </div>
        <div className="page-heading__actions">
          <Button icon={<ReloadOutlined />} aria-label="Refresh connections" onClick={() => void fetchConnections()}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>Add connection</Button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-card"><div className="stat-card__label">Configured connections</div><div className="stat-card__value">{connections.length}</div><div className="stat-card__hint">SSH endpoints in this workspace</div></div>
        <div className="stat-card"><div className="stat-card__label">Verified online</div><div className="stat-card__value">{Object.values(testResults).filter((result) => result.success).length}</div><div className="stat-card__hint">Based on the latest connection test</div></div>
        <div className="stat-card"><div className="stat-card__label">Repositories</div><div className="stat-card__value">Open resource tree</div><div className="stat-card__hint">Browse repositories from the sidebar</div></div>
      </div>

      {loading && connections.length === 0 ? <LoadingState label="Loading SSH connections…" /> : connections.length === 0 ? (
        <div className="content-card"><EmptyState title="Connect a remote workspace" description="Add an SSH connection to scan and work with repositories on another machine." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>Add your first connection</Button>} /></div>
      ) : (
        <div className="connection-grid">
          {connections.map((connection: any) => {
            const result = testResults[connection.id];
            const state = result ? (result.success ? 'connected' : 'error') : 'offline';
            return (
              <article className="connection-card" key={connection.id}>
                <div className="connection-card__top">
                  <div className="connection-card__title"><ApartmentOutlined /> <span>{connection.name}</span></div>
                  <StatusBadge status={state} label={result?.success ? 'Online' : result?.success === false ? 'Auth failed' : 'Not tested'} />
                </div>
                <div className="connection-card__meta">
                  <div><strong>Host</strong> {connection.username}@{connection.host}:{connection.port}</div>
                  <div><strong>Auth</strong> {connection.authType === 'privateKey' ? 'Private key' : connection.authType === 'sshAgent' ? 'SSH agent' : 'Password'}</div>
                </div>
                <div className="connection-card__actions">
                  <Button size="small" icon={<LinkOutlined />} loading={testLoading === connection.id} onClick={() => void handleTest(connection.id)}>Test connection</Button>
                  <Button size="small" type="primary" ghost icon={<FolderOpenOutlined />} onClick={() => navigate(`/repositories?connectionId=${connection.id}`)}>Repositories</Button>
                  <Popconfirm title="Delete this connection?" description="Repositories stored for this connection will no longer be reachable." onConfirm={() => void handleDelete(connection.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${connection.name}`} />
                  </Popconfirm>
                </div>
                {result?.error && <div className="connection-card__error"><WarningOutlined /> {result.error}</div>}
              </article>
            );
          })}
        </div>
      )}

      <Modal title="Add SSH connection" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => void form.submit()} okText="Save connection">
        <Form form={form} layout="vertical" onFinish={handleAdd} initialValues={{ port: 22, authType: 'password' }}>
          <Form.Item name="name" label="Connection name" rules={[{ required: true, message: 'Enter a name' }]}><Input prefix={<SafetyCertificateOutlined />} placeholder="Build server" /></Form.Item>
          <div className="form-grid-2">
            <Form.Item name="host" label="Host" rules={[{ required: true, message: 'Enter a host' }]}><Input placeholder="192.168.1.100" /></Form.Item>
            <Form.Item name="port" label="Port" rules={[{ required: true }]}><InputNumber min={1} max={65535} className="full-width" /></Form.Item>
          </div>
          <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Enter a username' }]}><Input placeholder="developer" /></Form.Item>
          <Form.Item name="authType" label="Authentication method"><Select options={[{ value: 'password', label: 'Password' }, { value: 'privateKey', label: 'Private key' }, { value: 'sshAgent', label: 'SSH agent' }]} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.authType !== current.authType}>
            {({ getFieldValue }) => getFieldValue('authType') === 'password' ? <Form.Item name="password" label="Password"><Input.Password /></Form.Item> : getFieldValue('authType') === 'privateKey' ? <><Form.Item name="privateKeyPath" label="Private key path"><Input placeholder="~/.ssh/id_rsa" /></Form.Item><Form.Item name="passphrase" label="Passphrase"><Input.Password /></Form.Item></> : null}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
