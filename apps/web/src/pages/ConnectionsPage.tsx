import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Input, App } from 'antd';
import {
  ApartmentOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';
import { connectionStatus, connectionStatusLabel } from '../stores/connectionStatus';
import { EmptyState, LoadingState, StatusBadge } from '../components/ui';
import { CollectionViewSwitch } from '../components/CollectionViewSwitch';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { AluneModal } from '../components/AluneModal';
import { AlunePopconfirm } from '../components/AlunePopconfirm';
import { useRepositoryStore } from '../stores/repositoryStore';
import { DialogIcon } from '../components/DialogIcons';
import { DialogNote, OptionCards } from '../components/DialogParts';

type AuthType = 'password' | 'privateKey' | 'sshAgent';

interface ConnectionFormValues {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

const AUTH_OPTIONS = [
  {
    value: 'password' as const,
    title: '密码',
    description: '每次连接时使用',
    icon: 'lock' as const,
  },
  {
    value: 'privateKey' as const,
    title: '私钥',
    description: '本机密钥文件',
    icon: 'key' as const,
  },
  {
    value: 'sshAgent' as const,
    title: 'SSH Agent',
    description: '不保存凭据',
    icon: 'shield' as const,
  },
];

// Form.Item injects value/onChange, so the cards behave like the former Select.
function AuthTypeCards({
  value,
  onChange,
}: {
  value?: AuthType;
  onChange?: (value: AuthType) => void;
}) {
  return (
    <OptionCards
      label="认证方式"
      value={value ?? 'password'}
      options={AUTH_OPTIONS}
      onChange={(next) => onChange?.(next)}
    />
  );
}

// Keeps the port numeric as InputNumber did, without the stepper the dialog skin does not cover.
const normalizePort = (value: unknown) => {
  const digits = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 5);
  return digits ? Number(digits) : undefined;
};

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
  const watchedName = Form.useWatch('name', form);
  const watchedHost = Form.useWatch('host', form);
  const watchedPort = Form.useWatch('port', form);
  const watchedUser = Form.useWatch('username', form);
  const formIncomplete =
    !watchedName?.trim() || !watchedHost?.trim() || !watchedPort || !watchedUser?.trim();

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

  const authLabel = (type: string) =>
    type === 'privateKey' ? '私钥' : type === 'sshAgent' ? 'SSH Agent' : '密码';

  const renderStatus = (id: string) => {
    const info = statuses[id];
    const state = connectionStatus(info);
    return (
      <StatusBadge
        status={state === 'disconnected' ? 'offline' : state}
        label={connectionStatusLabel(info)}
      />
    );
  };

  const renderActions = (connection: any) => (
    <div className="connection-card__actions">
      <Button
        size="small"
        icon={<LinkOutlined />}
        loading={testLoading === connection.id}
        onClick={() => void handleTest(connection.id)}
      >
        测试连接
      </Button>
      <Button
        size="small"
        type="primary"
        ghost
        icon={<FolderOpenOutlined />}
        onClick={() => navigate(`/repositories?connectionId=${connection.id}`)}
      >
        查看仓库
      </Button>
      <DeleteConnectionConfirm
        connection={connection}
        onConfirm={() => handleDelete(connection.id)}
      >
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          aria-label={`删除 ${connection.name}`}
        />
      </DeleteConnectionConfirm>
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
          <Button
            icon={<ReloadOutlined />}
            aria-label="刷新连接"
            onClick={() => void fetchConnections()}
          >
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
            添加连接
          </Button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-card">
          <div className="stat-card__label">已配置连接</div>
          <div className="stat-card__value">{connections.length}</div>
          <div className="stat-card__hint">当前工作区中的 SSH 端点</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">当前在线</div>
          <div className="stat-card__value">
            {Object.values(statuses).filter((info) => info.status === 'connected').length}
          </div>
          <div className="stat-card__hint">根据实际 SSH 连接状态</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">仓库</div>
          <div className="stat-card__value">打开资源树</div>
          <div className="stat-card__hint">从侧边栏浏览仓库</div>
        </div>
      </div>

      {loading && connections.length === 0 ? (
        <LoadingState label="正在加载 SSH 连接…" />
      ) : connections.length === 0 ? (
        <div className="content-card">
          <EmptyState
            title="连接远程工作区"
            description="添加 SSH 连接，以扫描并操作另一台机器上的仓库。"
            action={
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
                添加第一个连接
              </Button>
            }
          />
        </div>
      ) : view === 'list' ? (
        <div className="content-card">
          <div
            className="collection-table-scroll"
            role="region"
            aria-label="连接列表，可横向滚动"
            tabIndex={0}
          >
            <table className="collection-table connection-table" aria-label="连接列表">
              <colgroup>
                <col />
                <col className="collection-table__host-column" />
                <col className="collection-table__auth-column" />
                <col className="collection-table__status-column" />
                <col className="collection-table__actions-column" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">连接名称</th>
                  <th scope="col">主机</th>
                  <th scope="col">认证</th>
                  <th scope="col">状态</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection: any) => {
                  const host = `${connection.username}@${connection.host}:${connection.port}`;
                  return (
                    <tr key={connection.id}>
                      <th scope="row">
                        <div className="connection-card__title">
                          <ApartmentOutlined />
                          <span className="collection-text" title={connection.name}>
                            {connection.name}
                          </span>
                        </div>
                      </th>
                      <td>
                        <span className="collection-text collection-table__mono" title={host}>
                          {host}
                        </span>
                        {statuses[connection.id]?.error && (
                          <div className="connection-card__error">
                            <WarningOutlined /> {statuses[connection.id].error}
                          </div>
                        )}
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
                  <div className="connection-card__title">
                    <ApartmentOutlined />{' '}
                    <span className="collection-text" title={connection.name}>
                      {connection.name}
                    </span>
                  </div>
                  {renderStatus(connection.id)}
                </div>
                <div className="connection-card__meta">
                  <div>
                    <strong>主机</strong> {connection.username}@{connection.host}:{connection.port}
                  </div>
                  <div>
                    <strong>认证</strong> {authLabel(connection.authType)}
                  </div>
                </div>
                {renderActions(connection)}
                {info?.error && (
                  <div className="connection-card__error">
                    <WarningOutlined /> {info.error}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <AluneModal
        open={modalVisible}
        size="md"
        glyph="server"
        eyebrow={{ label: '连接', detail: 'SSH' }}
        title="添加 SSH 连接"
        description="保存后可以在这台主机上扫描和打开远程仓库。"
        okText="保存连接"
        busyText="正在保存…"
        hintVerb="保存"
        okDisabled={formIncomplete}
        onOk={() => form.validateFields().then(handleAdd)}
        onCancel={() => setModalVisible(false)}
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ port: 22, authType: 'password' }}
        >
          <Form.Item
            name="name"
            label="连接名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input
              prefix={<DialogIcon name="server" />}
              placeholder="构建服务器"
              autoComplete="off"
              data-autofocus
            />
          </Form.Item>
          <div className="dlg-fld-row is-end">
            <Form.Item
              name="host"
              label="主机"
              rules={[{ required: true, message: '请输入主机地址' }]}
            >
              <Input
                className="dlg-mono-input"
                prefix={<DialogIcon name="globe" />}
                placeholder="192.168.1.100"
                autoComplete="off"
                spellCheck={false}
              />
            </Form.Item>
            <Form.Item
              name="port"
              label="端口"
              normalize={normalizePort}
              rules={[
                { required: true, message: '请输入端口' },
                { type: 'number', min: 1, max: 65535, message: '端口范围为 1–65535' },
              ]}
            >
              <Input className="dlg-mono-input" inputMode="numeric" autoComplete="off" />
            </Form.Item>
          </div>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              className="dlg-mono-input"
              prefix={<DialogIcon name="user" />}
              placeholder="developer"
              autoComplete="off"
              spellCheck={false}
            />
          </Form.Item>
          <div className="dlg-fld">
            <span className="dlg-fld-label">认证方式</span>
            <Form.Item name="authType" noStyle>
              <AuthTypeCards />
            </Form.Item>
          </div>
          <Form.Item
            noStyle
            shouldUpdate={(previous, current) => previous.authType !== current.authType}
          >
            {({ getFieldValue }) =>
              getFieldValue('authType') === 'password' ? (
                <Form.Item name="password" label="密码">
                  <Input.Password prefix={<DialogIcon name="lock" />} autoComplete="off" />
                </Form.Item>
              ) : getFieldValue('authType') === 'privateKey' ? (
                <div className="dlg-fld-row">
                  <Form.Item name="privateKeyPath" label="私钥路径">
                    <Input
                      className="dlg-mono-input"
                      prefix={<DialogIcon name="key" />}
                      placeholder="~/.ssh/id_rsa"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Form.Item>
                  <Form.Item
                    name="passphrase"
                    label={
                      <span className="dlg-fld-label">
                        密钥口令 <small>可选</small>
                      </span>
                    }
                  >
                    <Input.Password autoComplete="off" />
                  </Form.Item>
                </div>
              ) : (
                <DialogNote tone="info" icon="shield" quiet>
                  <p>
                    Alune 不保存任何凭据，连接时会尝试运行 Alune 的电脑上的默认私钥{' '}
                    <code>~/.ssh/id_rsa</code>。
                  </p>
                </DialogNote>
              )
            }
          </Form.Item>
        </Form>
      </AluneModal>
    </div>
  );
}

/** P06: name the repositories that lose access instead of a generic warning. */
function DeleteConnectionConfirm({
  connection,
  onConfirm,
  children,
}: {
  connection: { id: string; name: string };
  onConfirm: () => unknown;
  children: ReactElement;
}) {
  const repositories = useRepositoryStore((state) => state.repositories);
  const listLoaded = useRepositoryStore((state) => state.listLoaded);
  const fetchRepositories = useRepositoryStore((state) => state.fetchRepositories);
  const linked = repositories.filter((repo: any) => repo.connectionId === connection.id);
  return (
    <AlunePopconfirm
      icon="server"
      title={`删除连接“${connection.name}”？`}
      description={
        !listLoaded
          ? '使用此连接的仓库将无法访问，远程主机上的文件不受影响。'
          : linked.length
            ? '以下仓库将无法访问，远程主机上的文件不受影响。'
            : '没有仓库使用此连接，可以放心删除。'
      }
      extra={
        listLoaded && linked.length ? (
          <span className="dlg-badges">
            {linked.map((repo: any) => (
              <span key={repo.id} className="dlg-badge is-mono" title={repo.path}>
                {repo.name}
              </span>
            ))}
          </span>
        ) : undefined
      }
      okText="删除连接"
      onOpenChange={(open) => {
        if (open && !listLoaded) void fetchRepositories();
      }}
      onConfirm={onConfirm}
    >
      {children}
    </AlunePopconfirm>
  );
}
