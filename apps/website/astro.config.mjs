import { defineConfig } from 'astro/config';

// GitHub project Pages. Keep the base in generated assets, anchors and metadata.
export default defineConfig({
  site: 'https://shaoclean.github.io',
  base: '/Alune',
  trailingSlash: 'always',
  output: 'static',
});
