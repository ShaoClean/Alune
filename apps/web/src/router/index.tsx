import { createBrowserRouter } from 'react-router-dom';
import { PullRequestCenterPage } from '../pages/PullRequestCenterPage';
import { Layout } from '../components/Layout';
import { ConnectionsPage } from '../pages/ConnectionsPage';
import { RepositoriesPage } from '../pages/RepositoriesPage';
import { RepositoryStartPage } from '../pages/RepositoryStartPage';
import { RepositoryBranchesPage } from '../pages/RepositoryBranchesPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: 'branches', element: <RepositoryBranchesPage /> },
      { path: 'pull-requests', element: <PullRequestCenterPage /> },
      { path: 'pull-requests/:repositoryId/:number', element: <PullRequestCenterPage /> },
      {
        path: 'settings/:category?',
        element: null,
      },
      {
        index: true,
        element: <RepositoryStartPage />,
      },
      {
        path: 'connections',
        element: <ConnectionsPage />,
      },
      {
        path: 'repositories',
        element: <RepositoriesPage />,
      },
      {
        // Layout keeps every open repository tab mounted and shows the addressed one.
        path: 'repositories/:id',
        element: null,
      },
    ],
  },
]);
