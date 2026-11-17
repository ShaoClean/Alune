// Source-only package aliases: never test potentially stale dist/ output.
import { registerHooks } from 'node:module';
import { readFileSync, appendFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import '../../apps/web/tests/resolve-ts.mjs';
const root = new URL('../../', import.meta.url);
const aliases = {
  '@alune/agent-client': 'packages/agent-client/src/browser.ts',
  '@alune/protocol': 'packages/protocol/src/index.ts',
  '@alune/domain': 'packages/domain/src/index.ts',
};
registerHooks({
  resolve(specifier, context, next) {
    if (aliases[specifier]) return next(new URL(aliases[specifier], root).href, context);
    if (specifier.startsWith('.') && context.parentURL) {
      for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (/\.(?:ts|tsx)$/.test(url.pathname) && existsSync(url)) return next(url.href, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:')) {
      const file = fileURLToPath(url);
      if (/\.(?:[cm]?js|tsx?|json)$/.test(file)) {
        const bytes = readFileSync(file);
        if (process.env.P0_CLIENT_TRACE) appendFileSync(process.env.P0_CLIENT_TRACE,
          JSON.stringify({ path: realpathSync(file), sha256: createHash('sha256').update(bytes).digest('hex') }) + '\n');
        if (/\.tsx?$/.test(file)) return { format: 'module', shortCircuit: true,
          source: transpileModule(bytes.toString(), { fileName: file, compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText };
      }
    }
    return next(url, context);
  },
});
