import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { PanelToggle } from '@alune/ui';
import { UnorderedListOutlined } from '@alune/ui/icons';

// Reserve room for both the 216px outline and a readable article after the file tree is resized.
const DOCK_MIN_WIDTH = 680;

export interface MarkdownOutlineControls {
  toolbar: HTMLElement;
  dockedOpen: boolean;
  setDockedOpen: (open: boolean) => void;
}

export function MarkdownOutline({
  articleRef,
  controls: { toolbar, dockedOpen, setDockedOpen },
  content,
}: {
  articleRef: RefObject<HTMLElement | null>;
  controls: MarkdownOutlineControls;
  content: string;
}) {
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<HTMLElement[]>([]);
  const [compact, setCompact] = useState(true);
  const [popupOpen, setPopupOpen] = useState(false);
  const [active, setActive] = useState(0);
  const clicked = useRef<{ index: number; scrollTop: number } | null>(null);
  const open = compact ? popupOpen : dockedOpen;
  const setOpen = compact ? setPopupOpen : setDockedOpen;

  useLayoutEffect(() => {
    clicked.current = null;
    setHeadings(
      Array.from(articleRef.current!.querySelectorAll<HTMLElement>('[data-outline-label]')),
    );
  }, [articleRef, content]);

  useLayoutEffect(() => {
    const reader = articleRef.current!.parentElement!;
    const measure = () => setCompact(reader.clientWidth < DOCK_MIN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(reader);
    return () => observer.disconnect();
  }, [articleRef]);

  useLayoutEffect(() => {
    if (!open || !headings.length) return;
    const article = articleRef.current!;
    function sync() {
      // Several targets can share the same clamped scroll position near EOF.
      if (clicked.current?.scrollTop === article.scrollTop) {
        setActive(clicked.current.index);
        return;
      }
      clicked.current = null;
      const threshold = article.getBoundingClientRect().top + 18;
      let start = 0;
      let end = headings.length;
      while (start < end) {
        const mid = (start + end) >>> 1;
        if (headings[mid].getBoundingClientRect().top <= threshold) start = mid + 1;
        else end = mid;
      }
      const bottom =
        article.scrollTop > 0 &&
        article.scrollTop + article.clientHeight >= article.scrollHeight - 1;
      setActive(bottom ? headings.length - 1 : Math.max(0, start - 1));
    }
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(article);
    article.addEventListener('scroll', sync, { passive: true });
    article.addEventListener('load', sync, true);
    return () => {
      observer.disconnect();
      article.removeEventListener('scroll', sync);
      article.removeEventListener('load', sync, true);
    };
  }, [articleRef, headings, open]);

  useLayoutEffect(() => {
    const link = nav.current?.querySelector('[aria-current="location"]');
    if (!open || !link) return;
    const list = link.parentElement!;
    const offset = link.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (offset < 0) list.scrollTop += offset;
    else if (offset + link.clientHeight > list.clientHeight)
      list.scrollTop += offset + link.clientHeight - list.clientHeight;
  }, [active, open, headings]);

  useEffect(() => {
    if (!open || !headings.length) return;
    const reader = articleRef.current!.parentElement!;
    const outside = (event: PointerEvent) => {
      if (
        compact &&
        event.target instanceof Node &&
        !nav.current?.contains(event.target) &&
        !toolbar.contains(event.target)
      )
        setPopupOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !(event.target instanceof Node))
        return;
      if (!reader.contains(event.target) && !toolbar.contains(event.target)) return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [articleRef, toolbar, compact, open, setOpen, headings.length]);

  if (!headings.length) return null;
  const minLevel = headings.reduce((min, el) => Math.min(min, Number(el.tagName[1])), 6);
  return (
    <>
      {createPortal(
        <button
          type="button"
          ref={toggle}
          className="markdown-outline-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          <UnorderedListOutlined />
          大纲
        </button>,
        toolbar,
      )}
      <nav
        ref={nav}
        id={id}
        hidden={!open}
        aria-label="文档大纲"
        className={'markdown-outline' + (compact ? ' markdown-outline--popup' : '')}
      >
        <div className="markdown-outline__header">
          <UnorderedListOutlined />
          <strong>文档大纲</strong>
          <span>{headings.length}</span>
          <PanelToggle
            side="right"
            expanded
            controls={id}
            panelName="大纲"
            workspaceShortcut={false}
            onClick={() => {
              setOpen(false);
              toggle.current?.focus();
            }}
          />
        </div>
        <div className="markdown-outline__links">
          {headings.map((heading, index) => {
            const label = heading.dataset.outlineLabel || '无标题';
            return (
              <a
                key={heading.id}
                href={'#' + encodeURIComponent(heading.id)}
                title={label}
                aria-current={index === active ? 'location' : undefined}
                style={{ paddingInlineStart: 12 + (Number(heading.tagName[1]) - minLevel) * 13 }}
                onClick={(event) => {
                  event.preventDefault();
                  heading.scrollIntoView({ block: 'start' });
                  heading.tabIndex = -1;
                  heading.focus({ preventScroll: true });
                  clicked.current = { index, scrollTop: articleRef.current!.scrollTop };
                  setActive(index);
                  if (compact) setPopupOpen(false);
                }}
              >
                {label}
              </a>
            );
          })}
        </div>
      </nav>
    </>
  );
}
