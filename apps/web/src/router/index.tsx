import { createBrowserRouter } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ConnectionsPage } from '../pages/ConnectionsPage';
import { RepositoriesPage } from '../pages/RepositoriesPage';
import { RepositoryDetailPage } from '../pages/RepositoryDetailPage';
import { AiGatewayPage } from '../pages/AiGatewayPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
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
      {
        path: 'ai',
        element: <AiGatewayPage />,
      },
    ],
  },
]);
