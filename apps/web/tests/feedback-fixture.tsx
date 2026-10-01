import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, Button, ConfigProvider, Input, theme as antTheme } from 'antd';
import { useAppearance } from '../src/appearance';
import { FeedbackProvider, FeedbackNotice, FeedbackScope } from '../src/components/Feedback';
import { FeedbackAlert } from '../src/components/FeedbackAlert';
import { AluneModal } from '../src/components/AluneModal';
import { DialogNote } from '../src/components/DialogParts';
import { ReviewActionBar } from '../src/components/PullRequestActions';
import { FilePreviewPane } from '../src/components/FilesView';
import { useFeedbackMessage } from '../src/components/useFeedbackMessage';
import '../src/index.css';
import '../src/theme.css';
import '../src/dialogs.css';
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
  const message = useFeedbackMessage();
  return (
    <main style={{ padding: 24 }}>
      <h1>提示迁移交互验收</h1>
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
    </main>
  );
}
function FixtureApp() {
  const theme = useAppearance((state) => state.theme);
  return (
    <ConfigProvider
      theme={{ algorithm: theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm }}
    >
      <App>
        <FeedbackProvider>
          <Fixture />
        </FeedbackProvider>
      </App>
    </ConfigProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FixtureApp />
  </StrictMode>,
);
