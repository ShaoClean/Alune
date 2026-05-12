import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu } from 'antd';
import { ApartmentOutlined, FolderOutlined } from '@ant-design/icons';

const { Content, Sider } = AntLayout;

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    {
      key: '/',
      icon: <ApartmentOutlined />,
      label: 'Connections',
    },
    {
      key: '/repositories',
      icon: <FolderOutlined />,
      label: 'Repositories',
    },
  ];

  const selectedKey = location.pathname.startsWith('/repositories')
    ? '/repositories'
    : '/';

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider theme="dark">
        <div style={{ height: 32, margin: 16, color: '#fff', fontSize: 18, fontWeight: 'bold' }}>
          RemoteGit
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <AntLayout>
        <Content style={{ margin: 16, padding: 24, background: '#fff', borderRadius: 8 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}