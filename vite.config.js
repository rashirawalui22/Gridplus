import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/recharts/')) return 'charts';
            if (id.includes('/node_modules/lucide-react/')) return 'icons';
            if (id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react/')) return 'react-vendor';
            if (id.includes('/node_modules/socket.io-client/') || id.includes('/node_modules/engine.io-client/')) return 'realtime';
            return undefined;
          },
        },
      },
    },
    server: {
      port: Number(process.env.VITE_PORT || env.VITE_PORT || 5173),
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: process.env.API_TARGET || env.API_TARGET || 'http://127.0.0.1:4000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: process.env.API_TARGET || env.API_TARGET || 'http://127.0.0.1:4000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
