import { cloneElement, useEffect, useState } from 'react';
import type { MouseEventHandler, ReactElement } from 'react';
import { ApartmentOutlined, FolderOutlined } from '@ant-design/icons';
import { Tooltip } from '@alune/ui';
import type { Repository } from '@alune/shared';
import { worktreeKindLabel } from '../stores/repositoryLabels';

export function RepositoryKindIcon({ kind }: { kind: Repository['worktreeKind'] }) {
  const Icon = kind === 'linked' ? ApartmentOutlined : FolderOutlined;
  return (
    <Icon
      className={`repository-kind-icon${kind === 'linked' ? ' repository-kind-icon--linked' : ''}`}
      aria-hidden
    />
  );
}

export function RepositoryIdentity({ repo, label }: { repo: Repository; label?: string }) {
  return (
    <span className={`repository-identity${label ? ' repository-identity--qualified' : ''}`}>
      <RepositoryKindIcon kind={repo.worktreeKind} />
      <span className="repository-identity__text">
        <span className="repository-identity__name">{repo.name}</span>
        {label && (
          <>
            <span className="repository-identity__separator" aria-hidden>
              ·
            </span>
            <span className="repository-identity__detail">{label}</span>
          </>
        )}
      </span>
    </span>
  );
}

export function RepositoryIdentityTooltip({
  repo,
  source,
  disabled = false,
  children,
}: {
  repo: Repository;
  source: string;
  disabled?: boolean;
  children: ReactElement<{ onClick?: MouseEventHandler<HTMLElement> }>;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [open]);
  return (
    <Tooltip
      open={open && !disabled}
      onOpenChange={(next) => {
        // A focus trap may briefly visit a background tab before restoring focus.
        // Its tooltip must not sit above the dialog in the Escape handler stack.
        const modalOpen =
          next &&
          Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"]')).some(
            (dialog) => dialog.getClientRects().length > 0,
          );
        setOpen(next && !modalOpen);
      }}
      trigger={['hover', 'focus']}
      mouseEnterDelay={0.4}
      placement="bottomLeft"
      color="var(--surface-raised)"
      classNames={{ root: 'repository-identity-tooltip' }}
      title={
        <div className="repository-identity-details">
          <div className="repository-identity-details__heading">
            <RepositoryKindIcon kind={repo.worktreeKind} />
            <strong>{repo.name}</strong>
            <span>{worktreeKindLabel(repo.worktreeKind) || 'Git 仓库'}</span>
          </div>
          <dl>
            <dt>来源</dt>
            <dd>{source}</dd>
            {repo.currentBranch && (
              <>
                <dt>分支</dt>
                <dd>{repo.currentBranch}</dd>
              </>
            )}
            <dt>路径</dt>
            <dd className="repository-identity-details__path">{repo.path}</dd>
          </dl>
        </div>
      }
    >
      {cloneElement(children, {
        onClick: (event) => {
          setOpen(false);
          children.props.onClick?.(event);
        },
      })}
    </Tooltip>
  );
}
