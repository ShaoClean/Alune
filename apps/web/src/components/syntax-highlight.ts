import { createElement } from 'react';
import type { ReactNode } from 'react';
import { prismTokenStyle } from '../code-themes';
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
      {
        key: index,
        className: ['token', token.type, ...aliases].join(' '),
        style: prismTokenStyle(token.type, aliases),
      },
      content,
    );
  });
}

export function highlight(code: string, language: string): ReactNode[] | null {
  const grammar = Prism.languages[language];
  return grammar ? render(Prism.tokenize(code, grammar)) : null;
}

// Tokenize a complete hunk side before splitting it, preserving multiline tokens.
// Each leaf keeps its inherited token style even when a comment/string spans rows.
function tokenLines(code: string, language: string) {
  const grammar = Prism.languages[language];
  if (!grammar) return null;
  type Segment = { text: string; classes: string[]; style: Record<string, string> };
  const lines: Segment[][] = [[]];
  function visit(stream: Stream, classes: string[] = [], style: Record<string, string> = {}) {
    for (const token of stream) {
      if (typeof token === 'string') {
        token.split('\n').forEach((text, index) => {
          if (index) lines.push([]);
          if (text) lines[lines.length - 1].push({ text, classes, style });
        });
      } else {
        const aliases = token.alias ? ([] as string[]).concat(token.alias) : [];
        visit(
          Array.isArray(token.content) ? token.content : [token.content],
          [...classes, token.type, ...aliases],
          { ...style, ...prismTokenStyle(token.type, aliases) },
        );
      }
    }
  }
  visit(Prism.tokenize(code, grammar));
  return lines;
}

export function highlightLines(code: string, language: string): ReactNode[][] | null {
  return (
    tokenLines(code, language)?.map((line) =>
      line.map((segment, key) =>
        segment.classes.length
          ? createElement(
              'span',
              {
                key,
                className: ['token', ...segment.classes].join(' '),
                style: segment.style,
              },
              segment.text,
            )
          : segment.text,
      ),
    ) ?? null
  );
}

const escapeHTML = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

// react-diff-viewer needs escaped HTML to compose word-change marks with syntax.
// File text is escaped here; tags and CSS are produced solely from our token map.
export function highlightLinesHTML(code: string, language: string): string[] {
  const lines = tokenLines(code, language);
  if (!lines) return code.split('\n').map(escapeHTML);
  return lines.map((line) =>
    line
      .map(({ text, classes, style }) => {
        if (!classes.length) return escapeHTML(text);
        const css = Object.entries(style)
          .map(
            ([key, value]) =>
              `${key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase())}:${value}`,
          )
          .join(';');
        return `<span class="${escapeHTML(['token', ...classes].join(' '))}" style="${escapeHTML(css)}">${escapeHTML(text)}</span>`;
      })
      .join(''),
  );
}

export function highlightLineHTML(code: string, language: string): string {
  return highlightLinesHTML(code, language).join('\n');
}
