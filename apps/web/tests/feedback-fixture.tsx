import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AluneUIProvider, Button, Input } from '@alune/ui';
import { MemoryRouter } from 'react-router-dom';
import { useAppearance } from '../src/appearance';
import { FeedbackNotice, FeedbackScope } from '../src/components/Feedback';
import { FeedbackAlert } from '../src/components/FeedbackAlert';
import { AluneModal } from '../src/components/AluneModal';
import { DialogNote } from '../src/components/DialogParts';
import { ReviewActionBar } from '../src/components/PullRequestActions';
import { FilePreviewPane } from '../src/components/FilesView';
import { useFeedbackMessage } from '../src/components/useFeedbackMessage';
import '@alune/ui/styles.css';
import { WorkspaceStatusBar } from '../src/components/WorkspaceStatusBar';
import { DiffViewer } from '../src/components/DiffViewer';
import { DesktopUpdateFeedback } from '../src/components/UpdatePanel';
import type { UpdateState } from '../src/types/desktop-updates';
import '../src/index.css';
import '../src/theme.css';
import '../src/dialogs.css';
import '../src/workspace-layout.css';
function Fixture() {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState(false);
  const [draft, setDraft] = useState('草稿不能丢失');
  const [tick, setTick] = useState(0);
  const [repo, setRepo] = useState('repo-a');
  const [progress, setProgress] = useState(false);
  const [file, setFile] = useState(false);
  const [previewCase, setPreviewCase] = useState('binary');
  const [permissions, setPermissions] = useState(false);
  const [long, setLong] = useState(0);
  const [noticeRevision, setNoticeRevision] = useState(0);
  const [storageFailure, setStorageFailure] = useState(false);
  const [localFailure, setLocalFailure] = useState(false);
  const [sshFailure, setSshFailure] = useState(false);
  const [updatesOpened, setUpdatesOpened] = useState(0);
  const message = useFeedbackMessage();
  return (
    <main style={{ padding: 24 }}>
      <h1>提示迁移交互验收</h1>
      <Button
        id="notifications"
        onClick={() => {
          setNoticeRevision((value) => value + 1);
          setStorageFailure(true);
          setLocalFailure(true);
          setSshFailure(true);
        }}
      >
        新增全应用通知
      </Button>
      <Button id="notice-revision" onClick={() => setNoticeRevision((value) => value + 1)}>
        更新通知
      </Button>
      <Button
        id="clear-notifications"
        onClick={() => {
          setNoticeRevision(0);
          setStorageFailure(false);
          setLocalFailure(false);
          setSshFailure(false);
        }}
      >
        解决所有问题
      </Button>
      <output id="updates-opened">{updatesOpened}</output>
      <DesktopUpdateFeedback
        state={
          noticeRevision
            ? ({
                supported: true,
                status: 'available',
                currentVersion: '0.6.0',
                latestVersion: `99.0.${noticeRevision - 1}`,
                revision: noticeRevision,
                background: false,
              } as UpdateState)
            : null
        }
        error={null}
        invoke={async () => {}}
        onUpdates={() => setUpdatesOpened((value) => value + 1)}
      />
      <FeedbackScope id="settings" label="设置">
        <FeedbackNotice
          source="workspace-storage"
          title={storageFailure ? '无法保存外观与工作区设置' : null}
          description="存储不可写"
          autoOpen={false}
        />
      </FeedbackScope>
      <FeedbackScope id="local" label="本机仓库">
        <FeedbackNotice
          source="sync"
          title={localFailure ? '本机拉取失败' : null}
          description="请检查仓库配置"
          actionLabel="重试本机"
          onAction={() => setLocalFailure(false)}
          autoOpen={false}
        />
      </FeedbackScope>
      <FeedbackScope id="ssh" label="SSH 仓库">
        <FeedbackNotice
          source="sync"
          title={sshFailure ? 'SSH 拉取失败' : null}
          description="请检查远端连接"
          type="warning"
          actionLabel="重试 SSH"
          onAction={() => setSshFailure(false)}
          autoOpen={false}
        />
      </FeedbackScope>
      <div id="workspace" style={{ height: 240, overflow: 'auto', border: '1px solid gray' }}>
        <div style={{ height: 700 }}>工作区布局与滚动基线</div>
      </div>
      <Button
        id="queue"
        onClick={() => {
          message.error('没有写入权限，请检查令牌的写权限、仓库角色及组织授权。');
          message.warning('Diff 不完整');
          message.success('配置已保存');
          message.info('能力限制说明');
        }}
      >
        四类并发提示
      </Button>
      <Button id="form" onClick={() => setOpen(true)}>
        打开表单
      </Button>
      <Button id="progress" onClick={() => setProgress(true)}>
        开始进度
      </Button>
      <Button id="tick" onClick={() => setTick((t) => t + 1)}>
        更新轮询
      </Button>
      <Button
        id="switch"
        onClick={() => {
          setRepo('repo-b');
          setProgress(false);
        }}
      >
        切换仓库
      </Button>
      <Button id="file" onClick={() => setFile(true)}>
        文件预览限制
      </Button>
      <select
        id="preview-case"
        aria-label="文件提示场景"
        value={previewCase}
        onChange={(e) => {
          setPreviewCase(e.target.value);
          setFile(true);
        }}
      >
        {['binary', 'too-large', 'unsupported-encoding', 'symlink', '403', '404'].map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
      <Button id="permissions" onClick={() => setPermissions(true)}>
        PR 写入权限
      </Button>
      {permissions && (
        <ReviewActionBar
          query={{
            remote: 'origin',
            target: 'https://github.com/fixture/repo',
            provider: 'github',
            number: 148,
          }}
          review={
            {
              actions: {
                merge: {
                  allowed: false,
                  reason: '没有写入权限，请检查令牌的写权限、仓库角色及组织授权。',
                },
                close: {
                  allowed: false,
                  reason: '没有写入权限，请检查令牌的写权限、仓库角色及组织授权。',
                },
                comment: { allowed: false, reason: '请配置有写入权限的访问令牌。' },
              },
              loading: false,
              error: '',
              notice: '',
              pending: false,
              load: async () => {},
              beginConfirmation: () => {},
            } as any
          }
        />
      )}
      <Button id="long" onClick={() => setLong((value) => value + 1)}>
        长文本提示
      </Button>
      <FeedbackNotice
        source="long-text"
        title={long ? '操作未完成' : null}
        eventKey={long}
        description={'完整错误上下文：repository/路径/很长的文件名.ts。请检查配置后重试。\n'.repeat(
          80,
        )}
      />
      <output id="tick-value">{tick}</output>
      <div style={{ height: 200 }}>
        <DiffViewer
          title="通知验收.txt"
          diff={
            'diff --git a/notice.txt b/notice.txt\n--- a/notice.txt\n+++ b/notice.txt\n@@ -1 +1 @@\n-before\n+after\n'
          }
        />
      </div>
      <FeedbackScope id={repo} label={repo}>
        <FeedbackNotice
          source="progress"
          title={progress ? 'Git 操作进行中' : null}
          description={`${tick} 秒，取消后已完成步骤会保留。`}
          eventKey="operation-1"
          type="info"
          actionLabel="取消操作"
          onAction={() => setProgress(false)}
        />
      </FeedbackScope>
      {file && (
        <FilePreviewPane
          repositoryId="fixture"
          entry={{
            name: `${previewCase}.bin`,
            path: previewCase === 'binary' ? 'binary.bin' : `${previewCase}.bin`,
            kind: 'file',
          }}
          file={
            (['403', '404'].includes(previewCase)
              ? {
                  phase: 'error',
                  path: `${previewCase}.bin`,
                  status: Number(previewCase),
                  message: '读取失败完整原因',
                }
              : {
                  phase: 'ready',
                  path: `${previewCase}.bin`,
                  preview: {
                    kind: previewCase,
                    size: 4096,
                    limit: 1024,
                    target: '../shared/config.json',
                  },
                }) as any
          }
          onRetry={() => setFile(false)}
        />
      )}
      <AluneModal
        title="配置表单"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => setFailure(true)}
        okText="模拟失败"
      >
        <Input id="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button id="rich" onClick={() => setFailure(true)}>
          测试错误
        </Button>
        {failure && (
          <DialogNote role="alert" tone="danger" title="保存失败">
            完整错误原因；当前草稿已保留。
          </DialogNote>
        )}
        {failure && (
          <FeedbackAlert
            source="second"
            title="第二条提示"
            type="info"
            description={
              <p>
                富文本 <code>context</code>
              </p>
            }
            action={<Button onClick={() => setFailure(false)}>重试</Button>}
          />
        )}
      </AluneModal>
      <div style={{ position: 'fixed', inset: 'auto 0 0' }}>
        <WorkspaceStatusBar
          repositories={[]}
          version="v0.6.0"
          inert={false}
          onSettings={() => {}}
          onUpdates={() => setUpdatesOpened((value) => value + 1)}
        />
      </div>
    </main>
  );
}
function FixtureApp() {
  const { theme, reduceMotion } = useAppearance();
  return (
    <AluneUIProvider theme={theme} reduceMotion={reduceMotion}>
      <MemoryRouter>
        <Fixture />
      </MemoryRouter>
    </AluneUIProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FixtureApp />
  </StrictMode>,
);
