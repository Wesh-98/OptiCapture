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
      hmr: process.env.DISABLE_HMR === 'true'
        ? false
        : { clientPort: 443, protocol: 'wss' },
      // 'all' allows any tunnel subdomain (trycloudflare.com, ngrok, etc.)
      // without needing to update TUNNEL_HOST each time the tunnel URL rotates
      allowedHosts: true as const,
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
