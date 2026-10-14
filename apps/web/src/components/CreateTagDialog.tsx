import { useEffect, useState } from 'react';
import { AluneModal, Input, Select, useFeedbackMessage, DialogField } from '@alune/ui';
import { TagOutlined } from '@ant-design/icons';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

export function CreateTagDialog({
  repoId,
  target = 'HEAD',
  onCreated,
  onCancel,
}: {
  repoId: string;
  target?: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const feedback = useFeedbackMessage();
  const [name, setName] = useState('');
  const [type, setType] = useState<'lightweight' | 'annotated'>('lightweight');
  const [message, setMessage] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void gitApi
      .tags(repoId)
      .then((tags) => {
        if (active) setNames(tags.map((tag) => tag.name));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [repoId]);
  const taken = names.includes(name);
  const invalid =
    !!name &&
    (/[\s\x00-\x1f\x7f~^:?*\[\\]/.test(name) ||
      /\.\.|@\{/.test(name) ||
      name.startsWith('-') ||
      name.endsWith('.') ||
      name.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock')));
  const create = async () => {
    setBusy(true);
    try {
      await gitApi.createTag(repoId, {
        name,
        target,
        type,
        ...(type === 'annotated' ? { message } : {}),
      });
      await useRepositoryStore.getState().fetchLog(repoId);
      feedback.success(`已创建标签 ${name}`);
      onCreated();
    } catch (error: any) {
      feedback.error(error.message || '创建标签失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AluneModal
      open
      size="sm"
      glyph={<TagOutlined />}
      eyebrow={{ label: '标签' }}
      title="创建标签"
      okText="创建标签"
      busyText="正在创建…"
      confirmLoading={busy}
      okDisabled={!name || taken || invalid || (type === 'annotated' && !message.trim())}
      onOk={create}
      onCancel={onCancel}
    >
      <p className="dlg-fld-hint">
        指向 <code title={target}>{target === 'HEAD' ? '当前 HEAD' : target.slice(0, 12)}</code>
      </p>
      <DialogField
        label="标签名称"
        status={taken || invalid ? 'error' : undefined}
        hint={
          (taken || invalid) &&
          (taken ? '已存在同名标签' : '名称不能包含空格或 Git 引用中的特殊字符')
        }
      >
        <Input
          aria-label="标签名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="v1.0.0"
          data-autofocus
          autoComplete="off"
          spellCheck={false}
          status={taken || invalid ? 'error' : undefined}
        />
      </DialogField>
      <DialogField label="标签类型" labelId="tag-type-label">
        <Select
          aria-labelledby="tag-type-label"
          value={type}
          onChange={setType}
          options={[
            { value: 'lightweight', label: '轻量标签' },
            { value: 'annotated', label: '附注标签' },
          ]}
        />
      </DialogField>
      {type === 'annotated' && (
        <DialogField
          label="附注"
          hint="遵循此仓库的提交签名或 tag.gpgsign 设置；SSH 仓库使用远端密钥。"
        >
          <Input.TextArea
            aria-label="标签附注"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="此版本的说明"
          />
        </DialogField>
      )}
    </AluneModal>
  );
}
