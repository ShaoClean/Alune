import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import remarkGfm from 'remark-gfm';

// GitHub project Pages. Keep the base in generated assets, anchors and metadata.
export default defineConfig({
  site: 'https://shaoclean.github.io',
  base: '/Alune',
  trailingSlash: 'always',
  output: 'static',
  integrations: [react(), mdx({ remarkPlugins: [remarkGfm] })],
  markdown: { shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } } },
});
