import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Release text is untrusted. Match the desktop's HTTP(S)-only external-link policy.
function webUrl(url: string) {
  try {
    const target = new URL(url);
    if (target.protocol === 'https:' || target.protocol === 'http:') return target.href;
  } catch {
    /* Relative and malformed URLs are displayed as text. */
  }
  return undefined;
}

const components: Components = {
  a: ({ href, title, children }) =>
    href ? (
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  // Avoid fetching remote images from release text; retain their descriptions.
  img: ({ alt }) => <>{alt}</>,
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
  table: ({ children }) => (
    <div className="release-notes__table" role="region" aria-label="更新说明表格" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
};
const remarkPlugins = [remarkGfm];

// Download progress changes frequently; unchanged notes do not need reparsing.
export const ReleaseNotes = memo(function ReleaseNotes({ notes }: { notes: string }) {
  return (
    <div className="release-notes" role="region" aria-label="更新说明内容" tabIndex={0}>
      {notes.trim() ? (
        <Markdown
          skipHtml
          remarkPlugins={remarkPlugins}
          urlTransform={webUrl}
          components={components}
        >
          {notes}
        </Markdown>
      ) : (
        <p className="release-notes__empty">此版本未提供更新说明。</p>
      )}
    </div>
  );
});
