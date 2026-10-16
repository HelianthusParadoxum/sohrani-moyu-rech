import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Метка сборки клиента: сервер сообщает свою, и устаревшая страница в браузере перезагружается сама.
const BUILD = Date.now().toString(36);

export default defineConfig({
  plugins: [
    react(),
    { name: 'build-id', apply: 'build', writeBundle: () => writeFileSync(resolve('dist/build.txt'), BUILD) },
  ],
  define: { __CLIENT_BUILD__: JSON.stringify(BUILD) },
  root: 'src/client',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
});
