export type MarkdownResource =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; fragment: string }
  | { kind: 'file'; path: string; fragment: string }
  | { kind: 'blocked'; reason: string };

export const isMarkdownFile = (path: string) => /\.md$/i.test(path);

// Never resolve repository resources against the app's origin. Decode each path
// segment once, then normalize it within the repository before calling its API.
export function resolveMarkdownResource(url: string, documentPath: string): MarkdownResource {
  const blocked = (reason: string): MarkdownResource => ({ kind: 'blocked', reason });
  const value = url.trim();
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return blocked('链接包含不支持的字符');
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    try {
      const target = new URL(value);
      if (target.protocol === 'http:' || target.protocol === 'https:')
        return { kind: 'external', url: target.href };
    } catch {
      return blocked('链接格式无效');
    }
    return blocked('仅支持 HTTP(S) 链接和仓库内相对路径');
  }
  if (value.startsWith('//')) return blocked('外部链接需要完整的 HTTP(S) 地址');

  try {
    const hash = value.indexOf('#');
    const fragment = hash < 0 ? '' : decodeURIComponent(value.slice(hash + 1));
    const path = value.split(/[?#]/, 1)[0];
    if (!path) return { kind: 'anchor', fragment };
    const parts = path.startsWith('/') ? [] : documentPath.split('/').slice(0, -1);
    for (const encoded of path.split('/')) {
      const part = decodeURIComponent(encoded);
      if (/[\u0000-\u001f\u007f/\\:]/.test(part)) return blocked('路径包含不支持的字符');
      if (part.toLowerCase() === '.git') return blocked('不能访问仓库的 .git 目录');
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) return blocked('资源路径超出当前仓库');
        parts.pop();
      } else parts.push(part);
    }
    if (!parts.length || path.endsWith('/')) return blocked('请在文件树中打开目录');
    return { kind: 'file', path: parts.join('/'), fragment };
  } catch {
    return blocked('链接包含无效的路径编码');
  }
}

// A small rehype plugin gives headings stable, scoped IDs without enabling HTML.
// Keep Chinese, accented text and inline-code text in the familiar heading slug.
type MarkdownNode = {
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
};
export const MARKDOWN_HEADING_PREFIX = 'file-markdown-';

export function markdownHeadingIds() {
  return (tree: MarkdownNode) => {
    const used = new Set<string>();
    const text = (node: MarkdownNode): string =>
      node.value ??
      (node.tagName === 'img' ? String(node.properties?.alt ?? '') : '') +
        (node.children?.map(text).join('') ?? '');
    const visit = (node: MarkdownNode) => {
      if (/^h[1-6]$/.test(node.tagName ?? '')) {
        const slug = text(node)
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
          .replace(/\s/g, '-');
        let unique = slug;
        for (let suffix = 1; used.has(unique); suffix++) unique = `${slug}-${suffix}`;
        used.add(unique);
        node.properties = { ...node.properties, id: `${MARKDOWN_HEADING_PREFIX}${unique}` };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
