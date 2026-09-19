import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';

// Match Vite's TypeScript imports and JSX when running stores/components with Node.
const iconsEntry = pathToFileURL(createRequire(import.meta.url).resolve('@ant-design/icons')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    // The icons package's ESM build uses extensionless imports; use its Node entry.
    if (specifier === '@ant-design/icons') {
      return nextResolve(iconsEntry, context);
    }
    if (specifier.startsWith('.') && context.parentURL) {
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        const candidate = new URL(specifier + suffix, context.parentURL);
        if (existsSync(candidate)) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.tsx')) {
      const source = readFileSync(new URL(url), 'utf8');
      return {
        format: 'module',
        shortCircuit: true,
        source: transpileModule(source, {
          compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
