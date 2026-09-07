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
      message.success('连接已添加');
      setModalVisible(false);
      form.resetFields();
    } catch (err: any) {
      message.error(err.message || '添加连接失败');
    }
  };

  const handleTest = async (id: string) => {
    setTestLoading(id);
    try {
      const result = await testConnection(id);
      setTestResults((previous) => ({ ...previous, [id]: result }));
      if (result.success) message.success('连接成功');
      else message.error(result.error || '连接失败');
    } catch (err: any) {
      message.error(err.message || '连接失败');
    } finally {
      setTestLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConnection(id);
      message.success('连接已移除');
    } catch (err: any) {
      message.error(err.message || '移除连接失败');
    }
  };

  return (
    <div>
      <div className="page-heading">
        <div>
          <h2>SSH 连接</h2>
          <p>管理用于访问远程仓库的 SSH 工作区。</p>
        </div>
        <div className="page-heading__actions">
          <Button icon={<ReloadOutlined />} aria-label="刷新连接" onClick={() => void fetchConnections()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>添加连接</Button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-card"><div className="stat-card__label">已配置连接</div><div className="stat-card__value">{connections.length}</div><div className="stat-card__hint">当前工作区中的 SSH 端点</div></div>
        <div className="stat-card"><div className="stat-card__label">已验证在线</div><div className="stat-card__value">{Object.values(testResults).filter((result) => result.success).length}</div><div className="stat-card__hint">根据最近一次连接测试</div></div>
        <div className="stat-card"><div className="stat-card__label">仓库</div><div className="stat-card__value">打开资源树</div><div className="stat-card__hint">从侧边栏浏览仓库</div></div>
      </div>

      {loading && connections.length === 0 ? <LoadingState label="正在加载 SSH 连接…" /> : connections.length === 0 ? (
        <div className="content-card"><EmptyState title="连接远程工作区" description="添加 SSH 连接，以扫描并操作另一台机器上的仓库。" action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>添加第一个连接</Button>} /></div>
      ) : (
        <div className="connection-grid">
          {connections.map((connection: any) => {
            const result = testResults[connection.id];
            const state = result ? (result.success ? 'connected' : 'error') : 'offline';
            return (
              <article className="connection-card" key={connection.id}>
                <div className="connection-card__top">
                  <div className="connection-card__title"><ApartmentOutlined /> <span>{connection.name}</span></div>
                  <StatusBadge status={state} label={result?.success ? '在线' : result?.success === false ? '认证失败' : '未测试'} />
                </div>
                <div className="connection-card__meta">
                  <div><strong>主机</strong> {connection.username}@{connection.host}:{connection.port}</div>
                  <div><strong>认证</strong> {connection.authType === 'privateKey' ? '私钥' : connection.authType === 'sshAgent' ? 'SSH Agent' : '密码'}</div>
                </div>
                <div className="connection-card__actions">
                  <Button size="small" icon={<LinkOutlined />} loading={testLoading === connection.id} onClick={() => void handleTest(connection.id)}>测试连接</Button>
                  <Button size="small" type="primary" ghost icon={<FolderOpenOutlined />} onClick={() => navigate(`/repositories?connectionId=${connection.id}`)}>查看仓库</Button>
                  <Popconfirm title="删除此连接？" description="与此连接关联的仓库将无法访问。" onConfirm={() => void handleDelete(connection.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除 ${connection.name}`} />
                  </Popconfirm>
                </div>
                {result?.error && <div className="connection-card__error"><WarningOutlined /> {result.error}</div>}
              </article>
            );
          })}
        </div>
      )}

      <Modal title="添加 SSH 连接" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => void form.submit()} okText="保存连接">
        <Form form={form} layout="vertical" onFinish={handleAdd} initialValues={{ port: 22, authType: 'password' }}>
          <Form.Item name="name" label="连接名称" rules={[{ required: true, message: '请输入名称' }]}><Input prefix={<SafetyCertificateOutlined />} placeholder="构建服务器" /></Form.Item>
          <div className="form-grid-2">
            <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入主机地址' }]}><Input placeholder="192.168.1.100" /></Form.Item>
            <Form.Item name="port" label="端口" rules={[{ required: true, message: '请输入端口' }]}><InputNumber min={1} max={65535} className="full-width" /></Form.Item>
          </div>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input placeholder="developer" /></Form.Item>
          <Form.Item name="authType" label="认证方式"><Select options={[{ value: 'password', label: '密码' }, { value: 'privateKey', label: '私钥' }, { value: 'sshAgent', label: 'SSH Agent' }]} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.authType !== current.authType}>
            {({ getFieldValue }) => getFieldValue('authType') === 'password' ? <Form.Item name="password" label="密码"><Input.Password /></Form.Item> : getFieldValue('authType') === 'privateKey' ? <><Form.Item name="privateKeyPath" label="私钥路径"><Input placeholder="~/.ssh/id_rsa" /></Form.Item><Form.Item name="passphrase" label="密钥口令"><Input.Password /></Form.Item></> : null}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
