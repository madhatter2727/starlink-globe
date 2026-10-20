import { defineConfig } from 'vite';
const SITE_URL = process.env.SITE_URL || 'https://starlink-globe.vercel.app';
export default defineConfig({
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500 },
  plugins: [{ name: 'site-url', transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL) }],
});
