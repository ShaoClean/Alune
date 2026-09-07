import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { router } from './router';

const queryClient = new QueryClient();

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#2563eb',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorBgContainer: '#ffffff',
          colorBorder: '#d5dce7',
          colorText: '#172033',
          colorTextSecondary: '#68758a',
          borderRadius: 8,
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Button: { controlHeight: 32, borderRadius: 7 },
          Input: { controlHeight: 34, activeBorderColor: '#2563eb', hoverBorderColor: '#aec6f5' },
          Select: { controlHeight: 34, activeBorderColor: '#2563eb', hoverBorderColor: '#aec6f5' },
          Card: { borderRadiusLG: 10 },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ConfigProvider>
  );
}

export default App;
