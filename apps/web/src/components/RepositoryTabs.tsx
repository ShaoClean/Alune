import { CloseOutlined, FolderOpenOutlined, PlusOutlined } from '@ant-design/icons';

interface Props {
  repositories: any[];
  activeId?: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onOpenRepository: () => void;
}

export function RepositoryTabs({
  repositories,
  activeId,
  onSelect,
  onClose,
  onOpenRepository,
}: Props) {
  if (repositories.length === 0) return null;

  return (
    <div className="repository-tabs" aria-label="已打开的仓库">
      <div className="repository-tabs__scroll" role="tablist" aria-label="已打开的仓库标签页">
        {repositories.map((repo) => {
          const active = repo.id === activeId;
          return (
            <div
              className={`repository-tab${active ? ' repository-tab--active' : ''}`}
              key={repo.id}
              role="presentation"
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="repository-tab__select"
                title={repo.path ? `${repo.name} · ${repo.path}` : repo.name}
                onClick={() => onSelect(repo.id)}
              >
                <FolderOpenOutlined />
                <span className="repository-tab__name">{repo.name}</span>
                {repo.isDirty && <span className="repository-tab__dirty" aria-label="有改动" />}
              </button>
              <button
                type="button"
                className="repository-tab__close"
                aria-label={`关闭 ${repo.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(repo.id);
                }}
              >
                <CloseOutlined />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="repository-tabs__open"
        aria-label="打开仓库"
        onClick={onOpenRepository}
      >
        <PlusOutlined />
        <span>打开仓库</span>
      </button>
    </div>
  );
}
