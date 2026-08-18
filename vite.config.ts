import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // Scoped to src/ only — prevents server.ts and config files from being importable by frontend code
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR === 'true' ? false : { clientPort: 443, protocol: 'wss' },
      // When TUNNEL_HOST is set, trust only that hostname (plus localhost) — this is
      // what the README and .env.example have always advertised. Left unset we fall
      // back to accepting any host, which keeps rotating trycloudflare.com / ngrok
      // URLs working without editing config on every restart. Setting TUNNEL_HOST is
      // the safer option for a long-lived tunnel: `allowedHosts: true` lets any
      // hostname that resolves to this machine reach the dev server.
      allowedHosts: process.env.TUNNEL_HOST
        ? [process.env.TUNNEL_HOST, 'localhost', '127.0.0.1']
        : (true as const),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replaceAll('\\', '/');

            if (!normalizedId.includes('/node_modules/')) {
              return undefined;
            }

            if (
              normalizedId.includes('/node_modules/react/') ||
              normalizedId.includes('/node_modules/react-dom/') ||
              normalizedId.includes('/node_modules/react-router/') ||
              normalizedId.includes('/node_modules/react-router-dom/') ||
              normalizedId.includes('/node_modules/scheduler/')
            ) {
              return 'vendor';
            }

            if (normalizedId.includes('/node_modules/lucide-react/')) {
              return 'icons';
            }

            if (normalizedId.includes('/node_modules/motion/')) {
              return 'motion';
            }

            if (
              normalizedId.includes('/node_modules/@zxing/browser/') ||
              normalizedId.includes('/node_modules/@zxing/library/')
            ) {
              return 'scanner';
            }

            return undefined;
          },
        },
      },
    },
  };
});
