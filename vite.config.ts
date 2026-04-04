import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR === 'true'
        ? false
        : { clientPort: 443, protocol: 'wss' },
      allowedHosts: process.env.TUNNEL_HOST ? [process.env.TUNNEL_HOST] : ['.trycloudflare.com'],
    },
  };
});