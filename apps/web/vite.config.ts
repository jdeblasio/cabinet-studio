import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works from any folder (GitHub Pages serves it under /cabinet-studio/).
  base: './',
  server: { port: 5173, strictPort: true },
});
