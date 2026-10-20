import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  // release tag on analytics events and errors; Railway sets the commit sha at build time
  define: { __BUILD__: JSON.stringify((process.env.RAILWAY_GIT_COMMIT_SHA || 'dev').slice(0, 7)) },
  plugins: [preact()],
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
