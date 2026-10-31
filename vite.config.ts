import path from 'path';
import { defineConfig } from '@lark-apaas/coding-preset-vite-react';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@client': path.resolve(__dirname, 'client'),
    },
  },
  // 前端静态资源（sw.js、favicon 等）放在 client/public
  publicDir: 'client/public',
});
