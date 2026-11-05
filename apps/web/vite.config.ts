import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

export default defineConfig(
  async ({ mode }): Promise<UserConfig> => ({
    plugins: [react(), ...(mode === 'agent' ? [(await import('./agent-dev')).agentDev()] : [])],
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: {
      // The linked workspace builds CommonJS for Node. Serve its TypeScript source
      // as ESM in the browser, including on a fresh checkout before dist exists.
      alias: {
        '@alune/agent-client': fileURLToPath(
          new URL('../../packages/agent-client/src/browser.ts', import.meta.url),
        ),
        '@alune/protocol': fileURLToPath(
          new URL('../../packages/protocol/src/index.ts', import.meta.url),
        ),
        '@alune/domain': fileURLToPath(
          new URL('../../packages/domain/src/index.ts', import.meta.url),
        ),
        '@alune/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      ...(mode === 'agent' ? { host: '127.0.0.1', cors: false } : {}),
      port: 5173,
      proxy:
        mode === 'agent'
          ? {}
          : {
              '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
              },
              '/socket.io': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                ws: true,
              },
            },
    },
  }),
);
