import type { ReactElement } from 'react';
import type { PopconfirmProps } from 'antd';
import { AlunePopconfirm, DialogPath } from '@alune/ui';
export { AlunePopconfirm } from '@alune/ui';

/** P05: the repository list and the workspace tree share one removal prompt. */
export function RemoveRepositoryConfirm({
  repository,
  onConfirm,
  placement,
  disabled,
  onOpenChange,
  children,
}: {
  repository: { name: string; path: string };
  onConfirm: () => unknown;
  placement?: PopconfirmProps['placement'];
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactElement;
}) {
  return (
    <AlunePopconfirm
      tone="safe"
      icon="folder"
      title={`从列表移除“${repository.name}”？`}
      description="只移除应用内登记，仓库目录与文件保持不变，之后可以重新打开。"
      extra={<DialogPath path={repository.path} />}
      okText="移除登记"
      placement={placement}
      disabled={disabled}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    >
      {children}
    </AlunePopconfirm>
  );
}
