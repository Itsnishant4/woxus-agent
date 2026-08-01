import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Serve /help from public/help/index.html and /buy + / as the React app
  },
});
