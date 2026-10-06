import { useEffect, useState } from 'react';
import { AluneModal, Input, Select, useFeedbackMessage } from '@alune/ui';
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
      <label className="dlg-fld">
        <span className="dlg-fld-label">标签名称</span>
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
        {(taken || invalid) && (
          <span className="dlg-fld-hint is-error" role="status">
            {taken ? '已存在同名标签' : '名称不能包含空格或 Git 引用中的特殊字符'}
          </span>
        )}
      </label>
      <div className="dlg-fld">
        <span className="dlg-fld-label" id="tag-type-label">
          标签类型
        </span>
        <Select
          aria-labelledby="tag-type-label"
          value={type}
          onChange={setType}
          options={[
            { value: 'lightweight', label: '轻量标签' },
            { value: 'annotated', label: '附注标签' },
          ]}
        />
      </div>
      {type === 'annotated' && (
        <label className="dlg-fld">
          <span className="dlg-fld-label">附注</span>
          <Input.TextArea
            aria-label="标签附注"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="此版本的说明"
          />
        </label>
      )}
    </AluneModal>
  );
}
