import { AppstoreOutlined, UnorderedListOutlined, BarChartOutlined } from '@ant-design/icons';
import { ViewSwitch } from '@alune/ui';
import { useWorkspaceStore } from '../stores/workspaceStore';
import type { CollectionPage } from '../stores/workspaceStore';

const views = [
  {
    value: 'grid',
    label: '卡片',
    ariaLabel: '卡片视图',
    icon: <AppstoreOutlined aria-hidden="true" />,
  },
  {
    value: 'list',
    label: '列表',
    ariaLabel: '列表视图',
    icon: <UnorderedListOutlined aria-hidden="true" />,
  },
] as const;
const repositoryViews = [
  ...views,
  {
    value: 'overview',
    label: '数据总览',
    ariaLabel: '数据总览视图',
    icon: <BarChartOutlined aria-hidden="true" />,
  },
] as const;

export function CollectionViewSwitch({ page }: { page: CollectionPage }) {
  const view = useWorkspaceStore((state) => state.collectionViews[page]);
  const setView = useWorkspaceStore((state) => state.setCollectionView);
  return (
    <ViewSwitch
      label={page === 'repositories' ? '仓库视图' : '连接视图'}
      value={view}
      options={page === 'repositories' ? repositoryViews : views}
      onChange={(next) => setView(page, next)}
    />
  );
}
