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
  App,
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
import { connectionStatus, connectionStatusLabel } from '../stores/connectionStatus';
import { EmptyState, LoadingState, StatusBadge } from '../components/ui';
import { CollectionViewSwitch } from '../components/CollectionViewSwitch';
import { useWorkspaceStore } from '../stores/workspaceStore';

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
  const { message } = App.useApp();
  const navigate = useNavigate();
  const view = useWorkspaceStore((state) => state.collectionViews.connections);
  const {
    connections,
    statuses,
    loading,
    fetchConnections,
    addConnection,
    deleteConnection,
    testConnection,
  } = useConnectionStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [testLoading, setTestLoading] = useState<string | null>(null);
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

  const authLabel = (type: string) => type === 'privateKey' ? '私钥' : type === 'sshAgent' ? 'SSH Agent' : '密码';

  const renderStatus = (id: string) => {
    const info = statuses[id];
    const state = connectionStatus(info);
    return <StatusBadge status={state === 'disconnected' ? 'offline' : state} label={connectionStatusLabel(info)} />;
  };

  const renderActions = (connection: any) => (
    <div className="connection-card__actions">
      <Button size="small" icon={<LinkOutlined />} loading={testLoading === connection.id} onClick={() => void handleTest(connection.id)}>测试连接</Button>
      <Button size="small" type="primary" ghost icon={<FolderOpenOutlined />} onClick={() => navigate(`/repositories?connectionId=${connection.id}`)}>查看仓库</Button>
      <Popconfirm title="删除此连接？" description="与此连接关联的仓库将无法访问。" onConfirm={() => void handleDelete(connection.id)}>
        <Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除 ${connection.name}`} />
      </Popconfirm>
    </div>
  );

  return (
    <div>
      <div className="page-heading">
        <div>
          <h2>SSH 连接</h2>
          <p>管理用于访问远程仓库的 SSH 工作区。</p>
        </div>
        <div className="page-heading__actions">
          <CollectionViewSwitch page="connections" />
          <Button icon={<ReloadOutlined />} aria-label="刷新连接" onClick={() => void fetchConnections()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>添加连接</Button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-card"><div className="stat-card__label">已配置连接</div><div className="stat-card__value">{connections.length}</div><div className="stat-card__hint">当前工作区中的 SSH 端点</div></div>
        <div className="stat-card"><div className="stat-card__label">当前在线</div><div className="stat-card__value">{Object.values(statuses).filter((info) => info.status === 'connected').length}</div><div className="stat-card__hint">根据实际 SSH 连接状态</div></div>
        <div className="stat-card"><div className="stat-card__label">仓库</div><div className="stat-card__value">打开资源树</div><div className="stat-card__hint">从侧边栏浏览仓库</div></div>
      </div>

      {loading && connections.length === 0 ? <LoadingState label="正在加载 SSH 连接…" /> : connections.length === 0 ? (
        <div className="content-card"><EmptyState title="连接远程工作区" description="添加 SSH 连接，以扫描并操作另一台机器上的仓库。" action={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>添加第一个连接</Button>} /></div>
      ) : view === 'list' ? (
        <div className="content-card">
          <div className="collection-table-scroll" role="region" aria-label="连接列表，可横向滚动" tabIndex={0}>
            <table className="collection-table connection-table" aria-label="连接列表">
              <colgroup><col /><col className="collection-table__host-column" /><col className="collection-table__auth-column" /><col className="collection-table__status-column" /><col className="collection-table__actions-column" /></colgroup>
              <thead><tr><th scope="col">连接名称</th><th scope="col">主机</th><th scope="col">认证</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
              <tbody>
                {connections.map((connection: any) => {
                  const host = `${connection.username}@${connection.host}:${connection.port}`;
                  return (
                    <tr key={connection.id}>
                      <th scope="row"><div className="connection-card__title"><ApartmentOutlined /><span className="collection-text" title={connection.name}>{connection.name}</span></div></th>
                      <td>
                        <span className="collection-text collection-table__mono" title={host}>{host}</span>
                        {statuses[connection.id]?.error && <div className="connection-card__error"><WarningOutlined /> {statuses[connection.id].error}</div>}
                      </td>
                      <td>{authLabel(connection.authType)}</td>
                      <td>{renderStatus(connection.id)}</td>
                      <td>{renderActions(connection)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="connection-grid">
          {connections.map((connection: any) => {
            const info = statuses[connection.id];
            return (
              <article className="connection-card" key={connection.id}>
                <div className="connection-card__top">
                  <div className="connection-card__title"><ApartmentOutlined /> <span className="collection-text" title={connection.name}>{connection.name}</span></div>
                  {renderStatus(connection.id)}
                </div>
                <div className="connection-card__meta">
                  <div><strong>主机</strong> {connection.username}@{connection.host}:{connection.port}</div>
                  <div><strong>认证</strong> {authLabel(connection.authType)}</div>
                </div>
                {renderActions(connection)}
                {info?.error && <div className="connection-card__error"><WarningOutlined /> {info.error}</div>}
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
