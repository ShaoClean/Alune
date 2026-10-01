import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';

// GitHub project Pages. Keep the base in generated assets, anchors and metadata.
export default defineConfig({
  site: 'https://shaoclean.github.io',
  base: '/Alune',
  trailingSlash: 'always',
  output: 'static',
  integrations: [react(), mdx()],
  markdown: { shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } } },
});
