import { createElement } from 'react';
import type { ReactNode } from 'react';
import './prism-manual';
import Prism from 'prismjs/components/prism-core.js';
import type { PrismToken } from 'prismjs/components/prism-core.js';
// Grammars load in dependency order; each extends the shared Prism instance.
import 'prismjs/components/prism-clike.js';
import 'prismjs/components/prism-markup.js';
import 'prismjs/components/prism-css.js';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-scss.js';
import 'prismjs/components/prism-less.js';
import 'prismjs/components/prism-markdown.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-rust.js';
import 'prismjs/components/prism-java.js';
import 'prismjs/components/prism-kotlin.js';
import 'prismjs/components/prism-c.js';
import 'prismjs/components/prism-cpp.js';
import 'prismjs/components/prism-csharp.js';
import 'prismjs/components/prism-ruby.js';
import 'prismjs/components/prism-sql.js';
import 'prismjs/components/prism-toml.js';
import 'prismjs/components/prism-ini.js';
import 'prismjs/components/prism-docker.js';
import 'prismjs/components/prism-diff.js';
import 'prismjs/components/prism-graphql.js';
import 'prismjs/components/prism-swift.js';
import 'prismjs/components/prism-lua.js';
import 'prismjs/components/prism-makefile.js';
import 'prismjs/components/prism-properties.js';

type Stream = Array<string | PrismToken>;

function render(stream: Stream): ReactNode[] {
  return stream.map((token, index) => {
    if (typeof token === 'string') return token;
    const aliases = token.alias ? ([] as string[]).concat(token.alias) : [];
    const content =
      typeof token.content === 'string'
        ? token.content
        : render(Array.isArray(token.content) ? token.content : [token.content]);
    // Tokens become React elements, so file content never passes through innerHTML.
    return createElement(
      'span',
      { key: index, className: ['token', token.type, ...aliases].join(' ') },
      content,
    );
  });
}

export function highlight(code: string, language: string): ReactNode[] | null {
  const grammar = Prism.languages[language];
  return grammar ? render(Prism.tokenize(code, grammar)) : null;
}
