import { useFeedbackMessage } from '../components/useFeedbackMessage';
import { useContext, useEffect, useRef, useState } from 'react';
import { Input } from 'antd';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { AluneConfirmControl, DialogHints, Kbd, useAluneConfirm } from '../components/AluneModal';
import { DialogIcon } from '../components/DialogIcons';
import { OptionCards } from '../components/DialogParts';

interface BranchConflictChoice {
  existing: boolean;
  name: string;
}

export function BranchConflictFields({
  localName,
  onChange,
}: {
  localName: string;
  onChange: (choice: BranchConflictChoice) => void;
}) {
  const control = useContext(AluneConfirmControl);
  const [mode, setMode] = useState<'existing' | 'create'>('existing');
  const [newName, setNewName] = useState('');
  const missing = mode === 'create' && !newName.trim();
  useEffect(() => {
    onChange({
      existing: mode === 'existing',
      name: mode === 'existing' ? localName : newName.trim(),
    });
    control?.setOkDisabled(missing);
  }, [mode, newName]);
  return (
    <>
      <OptionCards
        label="检出方式"
        columns={2}
        value={mode}
        onChange={setMode}
        options={[
          {
            value: 'existing',
            icon: 'swap',
            title: '切换到现有分支',
            description: `“${localName}”，保留跟踪关系`,
          },
          { value: 'create', icon: 'plus', title: '使用新名称', description: '创建新的跟踪分支' },
        ]}
      />
      {mode === 'create' && (
        <label className="dlg-fld">
          <span className="dlg-fld-label">新的本地分支名称</span>
          <Input
            autoFocus
            className="dlg-mono-input"
            prefix={<DialogIcon name="branch" />}
            aria-label="新的本地分支名称"
            placeholder={`${localName}-2`}
            autoComplete="off"
            spellCheck={false}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          {missing && <span className="dlg-fld-hint">请输入新的本地分支名称</span>}
        </label>
      )}
    </>
  );
}

// Both branch entry points use the same conflict choices and refresh behavior.
export function useBranchSwitch(repoId: string, onSwitched: () => void) {
  const message = useFeedbackMessage();
  const confirm = useAluneConfirm();
  const pending = useRef(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const switchBranch = async (name: string, isRemote?: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setSwitching(name);
    let target = name;
    let targetRemote = isRemote;
    let localName: string | undefined;
    try {
      while (true) {
        try {
          const result = await gitApi.switchBranch(repoId, target, localName, targetRemote);
          message.success(`已切换到“${result.branch}”`);
          const store = useRepositoryStore.getState();
          await Promise.all([store.fetchBranches(repoId), store.fetchLog(repoId)]);
          onSwitched();
          return;
        } catch (error: any) {
          const conflict = error.response?.data;
          if (conflict?.code !== 'LOCAL_BRANCH_EXISTS') throw error;
          let choice: BranchConflictChoice | null = { existing: true, name: conflict.localName };
          const accepted = await confirm({
            glyph: 'swap',
            eyebrow: { label: '分支', detail: name.replace(/^remotes\//, '') },
            title: '本地分支名称冲突',
            description: conflict.message,
            content: (
              <BranchConflictFields
                localName={conflict.localName}
                onChange={(value) => {
                  choice = value;
                }}
              />
            ),
            hints: (
              <DialogHints>
                <span>
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> 选择
                </span>
                <i />
                <span>
                  <Kbd>↵</Kbd> 继续
                </span>
              </DialogHints>
            ),
            okText: '继续',
            onOk: () => {
              if (!choice?.name) {
                message.error('请输入新的本地分支名称');
                return Promise.reject(new Error('请输入分支名称'));
              }
            },
          });
          if (!accepted) choice = null;
          if (!choice) return;
          target = choice.existing ? choice.name : name;
          targetRemote = choice.existing ? false : isRemote;
          localName = choice.existing ? undefined : choice.name;
        }
      }
    } catch (error: any) {
      message.error(error.message || '无法切换分支');
    } finally {
      pending.current = false;
      setSwitching(null);
    }
  };
  return { switching, switchBranch };
}
