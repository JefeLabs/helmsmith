import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Save-to-server: the designer talks to a running harness through this
// proxy (no CORS surface on the harness). Start the harness with a TCP
// listener and point HARNESS_URL at it:
//   HARNESS_URL=http://127.0.0.1:<tcpPort> pnpm dev
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    proxy: {
      '/harness': {
        target: process.env.HARNESS_URL ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/harness/, ''),
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
