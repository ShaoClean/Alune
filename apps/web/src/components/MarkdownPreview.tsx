import { FeedbackAlert } from './FeedbackAlert';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { diffImageMediaType } from '@alune/shared';
import { repositoryApi } from '../api';
import { errorMessage } from './files-tree';
import {
  MARKDOWN_HEADING_PREFIX,
  markdownHeadingIds,
  resolveMarkdownResource,
} from './markdown-resources';
import type { MarkdownResource } from './markdown-resources';

// Parsing very large Markdown can produce far more DOM nodes than the source view.
export const MARKDOWN_PREVIEW_MAX_CHARS = 256 * 1024;
const remarkPlugins = [remarkGfm];
const rehypePlugins = [markdownHeadingIds];
type OpenFile = (path: string, fragment: string) => void;

function MarkdownImage({
  resource,
  repositoryId,
  alt = '',
  title,
}: {
  resource: MarkdownResource;
  repositoryId?: string;
  alt?: string;
  title?: string;
}) {
  const [src, setSrc] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const path = resource.kind === 'file' ? resource.path : undefined;
  const supported = path ? diffImageMediaType(path) : null;

  useEffect(() => {
    if (!repositoryId || !path || !supported) return;
    const controller = new AbortController();
    repositoryApi.file(repositoryId, path, controller.signal).then(
      (preview) => {
        if (controller.signal.aborted) return;
        if (preview.kind === 'image' && preview.mediaType === supported)
          setSrc(`data:${preview.mediaType};base64,${preview.content}`);
        else
          setFailure(
            preview.kind === 'too-large'
              ? '图片超出预览大小限制'
              : preview.kind === 'symlink'
                ? '不会读取符号链接图片'
                : '此资源不是支持的图片',
          );
      },
      (error) => {
        if (!controller.signal.aborted) setFailure(errorMessage(error, '无法读取图片'));
      },
    );
    return () => controller.abort();
  }, [repositoryId, path, supported]);

  if (src && !failure)
    return (
      <img
        src={src}
        alt={alt}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailure('图片加载失败，可能已损坏或无法访问')}
      />
    );

  const reason =
    failure ??
    (resource.kind === 'blocked'
      ? resource.reason
      : resource.kind === 'external'
        ? `外部图片（${new URL(resource.url).hostname}）`
        : resource.kind === 'anchor'
          ? '未指定图片文件'
          : !supported
            ? '暂不支持此图片格式；支持 PNG、JPEG、GIF、WebP'
            : !repositoryId
              ? '无法读取仓库图片'
              : '正在读取图片…');
  return (
    <span className="markdown-preview__image-fallback" role="status">
      <span>
        {alt || '图片'}：{reason}
      </span>
      {resource.kind === 'external' && !failure && (
        <button
          type="button"
          className="text-button"
          onClick={(event) => {
            // Image badges are often wrapped in a link; loading should not open it.
            event.preventDefault();
            event.stopPropagation();
            setSrc(resource.url);
          }}
        >
          加载外部图片
        </button>
      )}
    </span>
  );
}

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  path,
  repositoryId,
  refreshToken = 0,
  fragment = '',
  onOpenFile,
}: {
  content: string;
  path: string;
  repositoryId?: string;
  refreshToken?: number;
  fragment?: string;
  onOpenFile?: OpenFile;
}) {
  const root = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState<string>();
  const followAnchor = useCallback((anchor: string) => {
    const article = root.current;
    if (!article) return;
    const target = anchor
      ? [...article.querySelectorAll<HTMLElement>('[id]')].find(
          (element) =>
            element.id === `${MARKDOWN_HEADING_PREFIX}${anchor}` || element.id === anchor,
        )
      : article;
    if (!target) {
      setNotice(`未找到文档锚点：${anchor}`);
      return;
    }
    setNotice(undefined);
    target.scrollIntoView({ block: 'start' });
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (fragment) followAnchor(fragment);
  }, [fragment, followAnchor]);

  const components = useMemo<Components>(
    () => ({
      a: ({ href = '', title, children }) => {
        const resource = resolveMarkdownResource(href, path);
        if (resource.kind === 'external')
          return (
            <a href={resource.url} title={title} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        if (resource.kind === 'blocked')
          return (
            <span className="markdown-preview__unavailable" title={resource.reason}>
              {children}
            </span>
          );
        if (resource.kind === 'file' && resource.path !== path && !onOpenFile)
          return <span title="请在文件树中打开此文件">{children}</span>;
        return (
          <a
            href={`#${encodeURIComponent(resource.fragment)}`}
            title={title ?? (resource.kind === 'file' ? resource.path : undefined)}
            onClick={(event) => {
              event.preventDefault();
              if (resource.kind === 'anchor' || resource.path === path)
                followAnchor(resource.fragment);
              else onOpenFile?.(resource.path, resource.fragment);
            }}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt, title }) => (
        <MarkdownImage
          key={JSON.stringify([repositoryId, path, src, refreshToken])}
          resource={resolveMarkdownResource(typeof src === 'string' ? src : '', path)}
          repositoryId={repositoryId}
          alt={alt}
          title={title}
        />
      ),
      pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
      table: ({ children }) => (
        <div
          className="markdown-preview__table"
          role="region"
          aria-label="Markdown 表格"
          tabIndex={0}
        >
          <table>{children}</table>
        </div>
      ),
    }),
    [repositoryId, path, refreshToken, onOpenFile, followAnchor],
  );

  return (
    <article ref={root} className="markdown-preview" aria-label="Markdown 预览" tabIndex={0}>
      {notice && <FeedbackAlert source="markdown-link" context={path} type="info" title={notice} />}
      {content.length > MARKDOWN_PREVIEW_MAX_CHARS ? (
        <FeedbackAlert
          source="markdown-limit"
          context={path}
          type="warning"
          title="Markdown 内容较大，已暂停渲染。请切换到「源码」查看完整内容。"
        />
      ) : !content.trim() ? (
        <p role="status">此文件只有空白内容。</p>
      ) : (
        <Markdown
          skipHtml
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          // Both URL-bearing renderers resolve their input with the same policy.
          urlTransform={(url) => url}
          components={components}
        >
          {content}
        </Markdown>
      )}
    </article>
  );
});
