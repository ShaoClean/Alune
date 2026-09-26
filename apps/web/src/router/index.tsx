import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ConnectionsPage } from '../pages/ConnectionsPage';
import { RepositoriesPage } from '../pages/RepositoriesPage';
import { RepositoryDetailPage } from '../pages/RepositoryDetailPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        path: 'settings/:category?',
        element: null,
      },
      {
        index: true,
        element: <Navigate to="/repositories" replace />,
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
        path: 'repositories/:id',
        element: <RepositoryDetailPage />,
      },
    ],
  },
]);
