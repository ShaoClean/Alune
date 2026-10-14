import { useState } from 'react';
import {
  Button,
  DialogBadge,
  DialogBadges,
  DialogCard,
  DialogField,
  DialogFieldRow,
  DialogIcon,
  DialogList,
  DialogListItem,
  DialogPath,
  Input,
  OrbButton,
  Select,
} from '@alune/ui';

export default function Example() {
  const [name, setName] = useState('feature/example');
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const taken = name.trim() === 'main';
  return (
    <div className="example">
      <section className="example-group">
        <h2 className="example-title">字段</h2>
        <div className="example-stack">
          <DialogField
            label="分支名称"
            mono
            status={!name.trim() || taken ? 'error' : 'ok'}
            hint={!name.trim() ? '请输入分支名称' : taken ? '已存在同名分支' : '名称可用'}
          >
            <Input
              prefix={<DialogIcon name="branch" />}
              value={name}
              status={!name.trim() || taken ? 'error' : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </DialogField>
          <DialogFieldRow end>
            <DialogField label="主机" extra="必填" mono>
              <Input defaultValue="example.local" />
            </DialogField>
            <DialogField label="端口" mono>
              <Input defaultValue="22" />
            </DialogField>
          </DialogFieldRow>
          <DialogField label="标签类型" labelId="example-tag-type">
            <Select
              aria-labelledby="example-tag-type"
              defaultValue="annotated"
              options={[
                { value: 'lightweight', label: '轻量标签' },
                { value: 'annotated', label: '附注标签' },
              ]}
            />
          </DialogField>
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">标签与列表</h2>
        <div className="example-stack">
          <DialogBadges>
            <DialogBadge>新建</DialogBadge>
            <DialogBadge tone="success" icon="check">
              可合并
            </DialogBadge>
            <DialogBadge tone="warning" icon="clock">
              暂不可合并
            </DialogBadge>
            <DialogBadge mono tone="success">
              +12
            </DialogBadge>
            <DialogBadge mono tone="danger">
              −3
            </DialogBadge>
          </DialogBadges>
          <DialogCard>
            <DialogList>
              <DialogListItem
                icon="folder"
                title="example-app"
                detail={<DialogPath path="/work/example-app" />}
              >
                <DialogBadge tone="success" icon="check">
                  已添加
                </DialogBadge>
              </DialogListItem>
              <DialogListItem
                icon="folder"
                title="example-docs"
                detail="子模块 · 有独立的 Git 状态"
              >
                <Button size="small">打开仓库</Button>
              </DialogListItem>
            </DialogList>
          </DialogCard>
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">带图标圆点的主操作</h2>
        <div className="example-row">
          <OrbButton
            icon="arrow-up-right"
            loading={busy}
            onClick={() => {
              setBusy(true);
              window.setTimeout(() => {
                setBusy(false);
                setOpened(true);
              }, 1200);
            }}
          >
            打开仓库
          </OrbButton>
          <span className="example-status" role="status">
            {busy ? '正在打开…' : opened ? '已打开示例仓库' : ''}
          </span>
        </div>
      </section>
    </div>
  );
}
