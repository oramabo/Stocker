import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // `wrangler dev` serves the Worker on 8787 during local development.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
