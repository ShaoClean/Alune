import type { ReactNode, SVGProps } from 'react';

// Stroke icons from the dialog design board (Wiki assets/issue-118/dialog-design, 3269eb2).
// 24px grid, 1.35 stroke, drawn with currentColor so tones apply through CSS.
const icons = {
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  'arrow-right': <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  'arrow-up-right': <path d="M7 17L17 7M8.5 7H17v8.5" />,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  caret: <path d="M7 10l5 5 5-5" />,
  warning: (
    <>
      <path d="M12 3.8l9.2 15.8H2.8Z" />
      <path d="M12 9.5v4.8M12 16.9v.2" />
    </>
  ),
  trash: <path d="M4 6.5h16M9.5 6.5v-2h5v2M6.5 6.5l.9 13h9.2l.9-13M10 10.5v6M14 10.5v6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.9v.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5v-3a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="4" />
      <path d="M10.9 12.6L19 4.5M15.5 8l2.5 2.5M13.5 10l1.8 1.8" />
    </>
  ),
  server: (
    <>
      <rect x="3.5" y="4" width="17" height="7" rx="2" />
      <rect x="3.5" y="13" width="17" height="7" rx="2" />
      <path d="M7.5 7.5h.2M7.5 16.5h.2M11 7.5h2M11 16.5h2" />
    </>
  ),
  folder: (
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h5l2 2.5h7A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18Z" />
  ),
  'folder-open': (
    <>
      <path d="M3.5 18.5v-12A1.5 1.5 0 0 1 5 5h5l2 2.5h6.5A1.5 1.5 0 0 1 20 9v1.3" />
      <path d="M3.5 18.5l2.6-7.2a1.5 1.5 0 0 1 1.4-1h13.2a1 1 0 0 1 .95 1.3L19.5 18.5Z" />
    </>
  ),
  branch: (
    <>
      <circle cx="7" cy="5.5" r="2" />
      <circle cx="7" cy="18.5" r="2" />
      <circle cx="17" cy="7.5" r="2" />
      <path d="M7 7.5v9M17 9.5c0 4.2-10 2.8-10 7" />
    </>
  ),
  merge: (
    <>
      <circle cx="7" cy="5.5" r="2" />
      <circle cx="7" cy="18.5" r="2" />
      <circle cx="17" cy="15" r="2" />
      <path d="M7 7.5v9M7 7.5c0 4.6 3.8 7.5 8 7.5" />
    </>
  ),
  pr: (
    <>
      <circle cx="6.5" cy="5.5" r="2" />
      <circle cx="6.5" cy="18.5" r="2" />
      <circle cx="17.5" cy="18.5" r="2" />
      <path d="M6.5 7.5v9M17.5 16.5V10a3 3 0 0 0-3-3h-4M12.5 4.5L10 7l2.5 2.5" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10M10 12.5h4" />
    </>
  ),
  'cloud-up': (
    <>
      <path d="M7.5 18.5H7a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 11a3.8 3.8 0 0 1-1.5 7.5h-.5" />
      <path d="M12 12.5v7M9.5 15L12 12.5l2.5 2.5" />
    </>
  ),
  'cloud-down': (
    <>
      <path d="M7.5 18.5H7a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 11a3.8 3.8 0 0 1-1.5 7.5h-.5" />
      <path d="M12 11.5v8M9.5 17l2.5 2.5 2.5-2.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5S9.6 6.1 12 3.5Z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20c1.3-3.6 4.1-5.5 7.5-5.5s6.2 1.9 7.5 5.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M7 9.5l3 2.5-3 2.5M12.5 15H17" />
    </>
  ),
  laptop: (
    <>
      <rect x="5" y="5.5" width="14" height="10" rx="1.5" />
      <path d="M3 18.5h18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <path d="M4 4l16 16M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.4M6.4 7.4C3.9 9.1 2.5 12 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  ),
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
  sparkle: (
    <path d="M12 3.5c.6 4.6 3.9 7.9 8.5 8.5-4.6.6-7.9 3.9-8.5 8.5-.6-4.6-3.9-7.9-8.5-8.5 4.6-.6 7.9-3.9 8.5-8.5Z" />
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  columns: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9 4.5v15M15 4.5v15" />
    </>
  ),
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15" />,
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  wave: <path d="M3 12c1.5-3.2 3-3.2 4.5 0s3 3.2 4.5 0 3-3.2 4.5 0 3 3.2 4.5 0" />,
  file: (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5Z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  'file-plus': (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5Z" />
      <path d="M13.5 3.5v5h5M12 11.5v5.5M9.3 14.2h5.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9" />
      <path d="M19.5 4.5V9H15" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  pencil: (
    <>
      <path d="M4.5 19.5l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L9 18.5Z" />
      <path d="M13.5 7l3.5 3.5" />
    </>
  ),
  swap: <path d="M4.5 8.5h14M15 5l3.5 3.5L15 12M19.5 15.5h-14M9 12l-3.5 3.5L9 19" />,
  shield: (
    <>
      <path d="M12 3.5l7 2.5v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6Z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  plug: <path d="M9 3.5v4M15 3.5v4M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0ZM12 16.5v4" />,
  tree: (
    <>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="18" cy="5.5" r="2" />
      <circle cx="12" cy="18.5" r="2" />
      <path d="M6 7.5v1a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-1M12 11.5v5" />
    </>
  ),
  commit: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M3 12h5.5M15.5 12H21" />
    </>
  ),
  chat: (
    <>
      <path d="M4.5 19V6A1.5 1.5 0 0 1 6 4.5h12A1.5 1.5 0 0 1 19.5 6v9a1.5 1.5 0 0 1-1.5 1.5H8Z" />
      <path d="M8.5 9h7M8.5 12.5h4" />
    </>
  ),
  dots: (
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 5L4.5 9l4 4" />
      <path d="M4.5 9h10a5 5 0 0 1 0 10H10" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type DialogIconName = keyof typeof icons;

export function DialogIcon({
  name,
  className,
  ...rest
}: { name: DialogIconName } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className ? `dlg-ic ${className}` : 'dlg-ic'}
      {...rest}
    >
      {icons[name]}
    </svg>
  );
}

export type DialogIconProps = { name: DialogIconName } & Omit<SVGProps<SVGSVGElement>, 'name'>;
