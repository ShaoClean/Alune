import { AppstoreOutlined, UnorderedListOutlined, BarChartOutlined } from '@ant-design/icons';
import { useWorkspaceStore } from '../stores/workspaceStore';
import type { CollectionPage } from '../stores/workspaceStore';

export function CollectionViewSwitch({ page }: { page: CollectionPage }) {
  const view = useWorkspaceStore((state) => state.collectionViews[page]);
  const setView = useWorkspaceStore((state) => state.setCollectionView);

  return (
    <div
      className="collection-view-switch"
      role="group"
      aria-label={page === 'repositories' ? '仓库视图' : '连接视图'}
    >
      <button
        type="button"
        aria-label="卡片视图"
        aria-pressed={view === 'grid'}
        onClick={() => setView(page, 'grid')}
      >
        <AppstoreOutlined aria-hidden="true" />
        <span>卡片</span>
      </button>
      <button
        type="button"
        aria-label="列表视图"
        aria-pressed={view === 'list'}
        onClick={() => setView(page, 'list')}
      >
        <UnorderedListOutlined aria-hidden="true" />
        <span>列表</span>
      </button>
      {page === 'repositories' && (
        <button
          type="button"
          aria-label="数据总览视图"
          aria-pressed={view === 'overview'}
          onClick={() => setView(page, 'overview')}
        >
          <BarChartOutlined aria-hidden="true" />
          <span>数据总览</span>
        </button>
      )}
    </div>
  );
}
