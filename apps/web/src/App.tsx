import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AluneUIProvider } from '@alune/ui';
import { router } from './router';
import { useAppearance } from './appearance';
const queryClient = new QueryClient();
function App() {
  const { theme, reduceMotion } = useAppearance();
  return (
    <QueryClientProvider client={queryClient}>
      <AluneUIProvider theme={theme} reduceMotion={reduceMotion}>
        <RouterProvider router={router} />
      </AluneUIProvider>
    </QueryClientProvider>
  );
}
export default App;
