import { FeedbackAlert } from './FeedbackAlert';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAppearance } from '../appearance';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { codeAppearanceStyle, resolveCodeTheme } from '../stores/codeAppearance';
import type { FileLanguage } from './file-language';

// Prism turns every token into an element; beyond this keep readable plain text.
export const HIGHLIGHT_MAX_CHARS = 256 * 1024;
// Returning from settings restores reading position, independently for each repository/file.
const scrollPositions = new Map<string, { top: number; left: number }>();
let highlighterModule: Promise<typeof import('./syntax-highlight')> | undefined;
const loadHighlighter = () =>
  (highlighterModule ??= import('./syntax-highlight').catch((error) => {
    highlighterModule = undefined;
    throw error;
  }));

function useHighlighter(enabled: boolean, path: string) {
  const [module, setModule] = useState<Awaited<ReturnType<typeof loadHighlighter>> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || module) return;
    let active = true;
    loadHighlighter().then(
      (loaded) => {
        if (active) {
          setModule(loaded);
          setFailed(false);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, module, path]);
  return { module, failed };
}

export function CodeView({
  path,
  text,
  lines,
  language,
  showNotice = true,
  scrollKey,
}: {
  path: string;
  text: string;
  lines: number;
  language: FileLanguage | null;
  showNotice?: boolean;
  scrollKey?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const position = scrollKey ? scrollPositions.get(scrollKey) : undefined;
    if (container.current && position) {
      container.current.scrollTop = position.top;
      container.current.scrollLeft = position.left;
    }
  }, [scrollKey]);
  const mode = useAppearance((state) => state.theme);
  const preferences = useWorkspaceStore((state) => state.codeAppearance);
  const notice = useWorkspaceStore((state) => state.codeAppearanceNotice);
  const theme = resolveCodeTheme(preferences, mode);
  const style = useMemo(
    () => codeAppearanceStyle(preferences, theme) as CSSProperties,
    [preferences, theme],
  );
  const highlightable = Boolean(language) && text.length <= HIGHLIGHT_MAX_CHARS;
  const { module: highlighter, failed } = useHighlighter(highlightable, path);
  const result = useMemo(() => {
    if (!highlightable || !highlighter || !language) return { tokens: null, failed: false };
    try {
      return { tokens: highlighter.highlight(text, language.id), failed: false };
    } catch {
      return { tokens: null, failed: true };
    }
  }, [highlightable, highlighter, language, text]);
  const gutter = useMemo(
    () => Array.from({ length: lines }, (_, index) => index + 1).join('\n'),
    [lines],
  );
  return (
    <>
      {showNotice && notice && (
        <FeedbackAlert
          source="code-appearance"
          context={path}
          type="warning"
          title={<>{notice}</>}
        />
      )}
      {language && !highlightable && (
        <FeedbackAlert
          source="code-highlight-size"
          context={path}
          type="warning"
          title={
            <>文件超过 {(HIGHLIGHT_MAX_CHARS / 1024).toFixed(1)} KB，已关闭语法高亮以保持流畅。</>
          }
        />
      )}
      {highlightable && (failed || result.failed) && (
        <FeedbackAlert
          source="code-highlight-error"
          context={path}
          type="warning"
          title={<>语法高亮加载失败，暂以纯文本显示，仍可选择和复制内容。重新加载应用后可重试。</>}
        />
      )}
      <div
        key={scrollKey ?? path}
        ref={container}
        onScroll={
          scrollKey
            ? (event) => {
                scrollPositions.delete(scrollKey);
                scrollPositions.set(scrollKey, {
                  top: event.currentTarget.scrollTop,
                  left: event.currentTarget.scrollLeft,
                });
                if (scrollPositions.size > 64)
                  scrollPositions.delete(scrollPositions.keys().next().value!);
              }
            : undefined
        }
        className="files-code"
        role="region"
        aria-label={`${path.slice(path.lastIndexOf('/') + 1)} 的内容`}
        tabIndex={0}
        style={style}
        data-code-theme={theme.id}
      >
        <div className="files-code__lines">
          <pre className="files-code__gutter" aria-hidden="true">
            {gutter}
          </pre>
          <pre className="files-code__content" data-language={language?.id}>
            <code>{result.tokens ?? text}</code>
          </pre>
        </div>
      </div>
    </>
  );
}
