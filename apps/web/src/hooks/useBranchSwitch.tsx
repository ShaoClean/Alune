import { useRef, useState } from 'react';
import { App, Input, Radio, Space } from 'antd';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

// Both branch entry points use the same conflict choices and refresh behavior.
export function useBranchSwitch(repoId: string, onSwitched: () => void) {
  const { modal, message } = App.useApp();
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
          const choice = await new Promise<{ existing: boolean; name: string } | null>(
            (resolve) => {
              let existing = true;
              let newName = '';
              modal.confirm({
                title: '本地分支名称冲突',
                content: (
                  <Space orientation="vertical">
                    <p>{conflict.message}</p>
                    <Radio.Group
                      defaultValue="existing"
                      onChange={(event) => {
                        existing = event.target.value === 'existing';
                      }}
                    >
                      <Space orientation="vertical">
                        <Radio value="existing">
                          切换到现有分支“{conflict.localName}”（保留跟踪关系）
                        </Radio>
                        <Radio value="create">使用新名称创建跟踪分支</Radio>
                      </Space>
                    </Radio.Group>
                    <Input
                      aria-label="新的本地分支名称"
                      placeholder="新的本地分支名称"
                      onChange={(event) => {
                        newName = event.target.value.trim();
                      }}
                    />
                  </Space>
                ),
                okText: '继续',
                cancelText: '取消',
                onOk: () => {
                  if (!existing && !newName) {
                    message.error('请输入新的本地分支名称');
                    return Promise.reject(new Error('请输入分支名称'));
                  }
                  resolve({ existing, name: existing ? conflict.localName : newName });
                },
                onCancel: () => resolve(null),
              });
            },
          );
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
