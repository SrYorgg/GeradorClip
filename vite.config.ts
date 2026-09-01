import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Runtime videos, gallery exports and project assets belong to the local API,
  // not to the frontend bundle. This keeps desktop builds small and avoids
  // copying user media into dist/.
  publicDir: false,
  server: {
    proxy: {
      '/api': 'http://localhost:3333',
      '/videos': 'http://localhost:3333',
      '/gallery': 'http://localhost:3333',
      '/project-assets': 'http://localhost:3333',
    },
  },
});
