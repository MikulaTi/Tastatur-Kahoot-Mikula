import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false
  },
  server: {
    port: 5173,
    host: true,
    open: true
  }
});
