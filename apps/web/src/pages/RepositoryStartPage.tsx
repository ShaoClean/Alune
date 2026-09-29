import { Button, Result, Spin } from 'antd';
import { Navigate } from 'react-router-dom';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

// Only the root address resumes the previous workspace. Explicit menu routes stay put.
export function RepositoryStartPage() {
  const { listLoaded, listError, listLoading, fetchRepositories } = useRepositoryStore();
  const activeId = useWorkspaceStore((state) => state.repositorySession.activeId);
  if (listLoaded)
    return <Navigate to={activeId ? `/repositories/${activeId}` : '/repositories'} replace />;
  if (listError)
    return (
      <Result
        status="warning"
        title="暂时无法恢复工作区"
        subTitle={listError}
        extra={
          <Button loading={listLoading} onClick={() => void fetchRepositories()}>
            重试
          </Button>
        }
      />
    );
  return <Spin aria-label="正在恢复工作区" />;
}
