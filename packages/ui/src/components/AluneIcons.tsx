import type { HTMLAttributes, ReactNode, SVGProps } from 'react';

/**
 * Alune Peach Duotone Icon System (方案 B · 月光柔彩双色).
 *
 * Visual spec aligned with the Peach glow 小月兽 brand mark:
 * - 24x24 optical grid, 1.75px stroke, round linecap & linejoin
 * - Generous rounded corners (rx 3-4) mirroring the squircle silhouette
 * - Soft translucent lavender-peach tint layer (.alune-ic__duo) inside closed shapes
 * - Auto-softens / falls back to crisp monoline at <=14px micro slots via CSS
 */
export const aluneIconPaths = {
  // --- Navigation & Arrows ---
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  'arrow-right': <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  'arrow-left': <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />,
  'arrow-up': <path d="M12 19.5v-15M6 10.5l6-6 6 6" />,
  'arrow-down': <path d="M12 4.5v15M6 13.5l6 6 6-6" />,
  'arrow-up-right': <path d="M7 17L17 7M8.8 7H17v8.2" />,
  caret: <path d="M7.5 10l4.5 4.5 4.5-4.5" />,
  down: <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />,
  up: <path d="M6.5 14.5L12 9l5.5 5.5" />,
  right: <path d="M9.5 6.5L15 12l-5.5 5.5" />,
  'caret-right': (
    <>
      <path className="alune-ic__duo" d="M9 6.8a1.4 1.4 0 0 1 2.2-1.1l6.4 4.8a1.8 1.8 0 0 1 0 3l-6.4 4.8A1.4 1.4 0 0 1 9 17.2Z" />
      <path d="M9 6.8a1.4 1.4 0 0 1 2.2-1.1l6.4 4.8a1.8 1.8 0 0 1 0 3l-6.4 4.8A1.4 1.4 0 0 1 9 17.2Z" />
    </>
  ),

  // --- Status & Feedback ---
  check: <path d="M5 12.5l4.8 4.8L19.2 7.2" />,
  'check-circle': (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="8.2" />
      <path d="M8.6 12.3l2.4 2.4 4.6-4.8" />
    </>
  ),
  warning: (
    <>
      <path
        className="alune-ic__duo"
        d="M10.1 5.2a2.2 2.2 0 0 1 3.8 0l6.2 10.8a2.2 2.2 0 0 1-1.9 3.3H5.8a2.2 2.2 0 0 1-1.9-3.3Z"
      />
      <path d="M10.1 5.2a2.2 2.2 0 0 1 3.8 0l6.2 10.8a2.2 2.2 0 0 1-1.9 3.3H5.8a2.2 2.2 0 0 1-1.9-3.3Z" />
      <path d="M12 10v3.8M12 16.5h.01" />
    </>
  ),
  info: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11.2v5M12 8.2h.01" />
    </>
  ),
  'question-circle': (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="8.2" />
      <path d="M9.6 9.5a2.6 2.6 0 0 1 4.9 1c0 1.6-2.5 2-2.5 3.3M12 16.6h.01" />
    </>
  ),
  bell: (
    <>
      <path
        className="alune-ic__duo"
        d="M6.2 16.2V11a5.8 5.8 0 0 1 11.6 0v5.2l1.2 1.6a1 1 0 0 1-.8 1.6H5.8a1 1 0 0 1-.8-1.6Z"
      />
      <path d="M6.2 16.2V11a5.8 5.8 0 0 1 11.6 0v5.2l1.2 1.6a1 1 0 0 1-.8 1.6H5.8a1 1 0 0 1-.8-1.6Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  sparkle: (
    <>
      <path
        className="alune-ic__duo"
        d="M12 3.6c.7 4.4 4 7.7 8.4 8.4-4.4.7-7.7 4-8.4 8.4-.7-4.4-4-7.7-8.4-8.4 4.4-.7 7.7-4 8.4-8.4Z"
      />
      <path d="M12 3.6c.7 4.4 4 7.7 8.4 8.4-4.4.7-7.7 4-8.4 8.4-.7-4.4-4-7.7-8.4-8.4 4.4-.7 7.7-4 8.4-8.4Z" />
    </>
  ),

  // --- Git & Version Control ---
  branch: (
    <>
      <circle className="alune-ic__duo" cx="7" cy="6" r="2.3" />
      <circle className="alune-ic__duo" cx="7" cy="18" r="2.3" />
      <circle className="alune-ic__duo" cx="17" cy="8" r="2.3" />
      <circle cx="7" cy="6" r="2.3" />
      <circle cx="7" cy="18" r="2.3" />
      <circle cx="17" cy="8" r="2.3" />
      <path d="M7 8.3v7.4M17 10.3c0 4.2-4 5.2-10 5.4" />
    </>
  ),
  merge: (
    <>
      <circle className="alune-ic__duo" cx="7" cy="6" r="2.3" />
      <circle className="alune-ic__duo" cx="7" cy="18" r="2.3" />
      <circle className="alune-ic__duo" cx="17" cy="15.5" r="2.3" />
      <circle cx="7" cy="6" r="2.3" />
      <circle cx="7" cy="18" r="2.3" />
      <circle cx="17" cy="15.5" r="2.3" />
      <path d="M7 8.3v7.4M7 8.5c0 4.4 3.4 7 7.7 7" />
    </>
  ),
  pr: (
    <>
      <circle className="alune-ic__duo" cx="6.5" cy="6" r="2.2" />
      <circle className="alune-ic__duo" cx="6.5" cy="18" r="2.2" />
      <circle className="alune-ic__duo" cx="17.5" cy="18" r="2.2" />
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="6.5" cy="18" r="2.2" />
      <circle cx="17.5" cy="18" r="2.2" />
      <path d="M6.5 8.2v7.6M17.5 15.8V10a3.5 3.5 0 0 0-3.5-3.5h-2.5M13.5 4.5 11.2 6.5l2.3 2" />
    </>
  ),
  commit: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="3.8" />
      <circle cx="12" cy="12" r="3.8" />
      <path d="M3.5 12h4.7M15.8 12h4.7" />
    </>
  ),
  tree: (
    <>
      <circle className="alune-ic__duo" cx="6.5" cy="6" r="2.2" />
      <circle className="alune-ic__duo" cx="17.5" cy="6" r="2.2" />
      <circle className="alune-ic__duo" cx="12" cy="18" r="2.2" />
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="17.5" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M6.5 8.2v1.3a3 3 0 0 0 3 3h5a3 3 0 0 0 3-3V8.2M12 12.5v3.3" />
    </>
  ),
  diff: (
    <>
      <rect className="alune-ic__duo" x="4" y="3.5" width="16" height="17" rx="4" />
      <rect x="4" y="3.5" width="16" height="17" rx="4" />
      <path d="M9.5 9.2h5M12 6.7v5M9.5 15.5h5" />
    </>
  ),
  history: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="7.4" />
      <path d="M4.2 12a7.8 7.8 0 1 0 2.1-5.3L4.5 8.5" />
      <path d="M4.5 4.8v3.7h3.7" />
      <path d="M12 8.2v4l2.8 1.8" />
    </>
  ),
  tag: (
    <>
      <path
        className="alune-ic__duo"
        d="M4.2 11.2V6.8A2.6 2.6 0 0 1 6.8 4.2h4.4a3 3 0 0 1 2.1.88l6.1 6.1a2.6 2.6 0 0 1 0 3.68l-4.54 4.54a2.6 2.6 0 0 1-3.68 0l-6.1-6.1a3 3 0 0 1-.88-2.1Z"
      />
      <path d="M4.2 11.2V6.8A2.6 2.6 0 0 1 6.8 4.2h4.4a3 3 0 0 1 2.1.88l6.1 6.1a2.6 2.6 0 0 1 0 3.68l-4.54 4.54a2.6 2.6 0 0 1-3.68 0l-6.1-6.1a3 3 0 0 1-.88-2.1Z" />
      <circle cx="8.8" cy="8.8" r="1.2" />
    </>
  ),
  archive: (
    <>
      <path className="alune-ic__duo" d="M5.2 9v7.3a3.2 3.2 0 0 0 3.2 3.2h7.2a3.2 3.2 0 0 0 3.2-3.2V9Z" />
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="2" />
      <path d="M5.2 9v7.3a3.2 3.2 0 0 0 3.2 3.2h7.2a3.2 3.2 0 0 0 3.2-3.2V9M10 13.5h4" />
    </>
  ),
  inbox: (
    <>
      <path
        className="alune-ic__duo"
        d="M4 13.5h4.2l1.4 2.2a1.6 1.6 0 0 0 1.3.7h2.2a1.6 1.6 0 0 0 1.3-.7l1.4-2.2H20v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"
      />
      <rect x="4" y="4.5" width="16" height="15" rx="3.5" />
      <path d="M4 13.5h4.2l1.4 2.2a1.6 1.6 0 0 0 1.3.7h2.2a1.6 1.6 0 0 0 1.3-.7l1.4-2.2H20" />
    </>
  ),
  sync: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="5.4" />
      <path d="M19.5 11.5a7.5 7.5 0 0 0-13.2-4.8L4.8 8.3" />
      <path d="M4.8 4.8v3.5h3.5" />
      <path d="M4.5 12.5a7.5 7.5 0 0 0 13.2 4.8l1.5-1.6" />
      <path d="M19.2 19.2v-3.5h-3.5" />
    </>
  ),
  refresh: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="5.8" />
      <path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2L19.4 9" />
      <path d="M19.4 4.8V9h-4.2" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 5.2L4.5 9l4 3.8" />
      <path d="M4.5 9h9.8a4.9 4.9 0 0 1 0 9.8H9.5" />
    </>
  ),
  rollback: (
    <>
      <path d="M9 6L5 9.5 9 13" />
      <path d="M5 9.5h9a4.8 4.8 0 0 1 0 9.6H8.5" />
    </>
  ),

  // --- Files & Folders ---
  folder: (
    <>
      <path
        className="alune-ic__duo"
        d="M3.5 8.2A3.2 3.2 0 0 1 6.7 5h2.6a2.5 2.5 0 0 1 2 .95l.8 1.05a2 2 0 0 0 1.6.8h3.6a3.2 3.2 0 0 1 3.2 3.2v5.3a3.2 3.2 0 0 1-3.2 3.2H6.7a3.2 3.2 0 0 1-3.2-3.2Z"
      />
      <path d="M3.5 8.2A3.2 3.2 0 0 1 6.7 5h2.6a2.5 2.5 0 0 1 2 .95l.8 1.05a2 2 0 0 0 1.6.8h3.6a3.2 3.2 0 0 1 3.2 3.2v5.3a3.2 3.2 0 0 1-3.2 3.2H6.7a3.2 3.2 0 0 1-3.2-3.2Z" />
    </>
  ),
  'folder-open': (
    <>
      <path
        className="alune-ic__duo"
        d="M3.5 17.5l2.2-6a2.5 2.5 0 0 1 2.3-1.6h11.3a1.6 1.6 0 0 1 1.5 2.1l-1.9 5.5a2.4 2.4 0 0 1-2.3 1.7H5.7a2.2 2.2 0 0 1-2.2-1.7Z"
      />
      <path d="M3.5 17.2V8A3 3 0 0 1 6.5 5h2.6a2.4 2.4 0 0 1 1.9.9l.8 1a2 2 0 0 0 1.5.7h3.5a2.8 2.8 0 0 1 2.7 2.3" />
      <path d="M3.5 17.5l2.2-6a2.5 2.5 0 0 1 2.3-1.6h11.3a1.6 1.6 0 0 1 1.5 2.1l-1.9 5.5a2.4 2.4 0 0 1-2.3 1.7H5.7a2.2 2.2 0 0 1-2.2-1.7Z" />
    </>
  ),
  file: (
    <>
      <path
        className="alune-ic__duo"
        d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h8.4a2.8 2.8 0 0 0 2.8-2.8V9.2Z"
      />
      <path d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h8.4a2.8 2.8 0 0 0 2.8-2.8V9.2Z" />
      <path d="M13.2 4v3.4a2 2 0 0 0 2 2h3.6" />
    </>
  ),
  'file-plus': (
    <>
      <path
        className="alune-ic__duo"
        d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h8.4a2.8 2.8 0 0 0 2.8-2.8V9.2Z"
      />
      <path d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h8.4a2.8 2.8 0 0 0 2.8-2.8V9.2Z" />
      <path d="M13.2 4v3.4a2 2 0 0 0 2 2h3.6M12 11.8v5M9.5 14.3h5" />
    </>
  ),
  'file-text': (
    <>
      <path
        className="alune-ic__duo"
        d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h8.4a2.8 2.8 0 0 0 2.8-2.8V9.2Z"
      />
      <path d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h8.4a2.8 2.8 0 0 0 2.8-2.8V9.2Z" />
      <path d="M13.2 4v3.4a2 2 0 0 0 2 2h3.6M8.8 13h6.4M8.8 16.2h4.2" />
    </>
  ),
  'file-exclamation': (
    <>
      <path
        className="alune-ic__duo"
        d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h8.4a2.8 2.8 0 0 0 2.8-2.8V9.2Z"
      />
      <path d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h8.4a2.8 2.8 0 0 0 2.8-2.8V9.2Z" />
      <path d="M13.2 4v3.4a2 2 0 0 0 2 2h3.6M12 11.6v3M12 17h.01" />
    </>
  ),
  'file-search': (
    <>
      <path
        className="alune-ic__duo"
        d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h8.4a2.8 2.8 0 0 0 2.8-2.8V9.2Z"
      />
      <path d="M13.5 3.8H7.8A2.8 2.8 0 0 0 5 6.6v10.8a2.8 2.8 0 0 0 2.8 2.8h3.2M19 10.5V9.2l-5.5-5.4" />
      <circle cx="15" cy="15.5" r="3" />
      <path d="M17.3 17.8l2.2 2.2" />
    </>
  ),

  // --- Infrastructure, Devices & Network ---
  server: (
    <>
      <rect className="alune-ic__duo" x="3.5" y="4" width="17" height="6.8" rx="3" />
      <rect className="alune-ic__duo" x="3.5" y="13.2" width="17" height="6.8" rx="3" />
      <rect x="3.5" y="4" width="17" height="6.8" rx="3" />
      <rect x="3.5" y="13.2" width="17" height="6.8" rx="3" />
      <path d="M7.5 7.4h.2M7.5 16.6h.2M11 7.4h5M11 16.6h5" />
    </>
  ),
  laptop: (
    <>
      <rect className="alune-ic__duo" x="4.5" y="5" width="15" height="10.5" rx="3" />
      <rect x="4.5" y="5" width="15" height="10.5" rx="3" />
      <path d="M3 18.8h18" />
    </>
  ),
  terminal: (
    <>
      <rect className="alune-ic__duo" x="3.5" y="4.5" width="17" height="15" rx="4" />
      <rect x="3.5" y="4.5" width="17" height="15" rx="4" />
      <path d="M8 9.8l2.6 2.2L8 14.2M12.8 14.5H16" />
    </>
  ),
  globe: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4M12 3.8c2.3 2.5 3.5 5.2 3.5 8.2s-1.2 5.7-3.5 8.2c-2.3-2.5-3.5-5.2-3.5-8.2s1.2-5.7 3.5-8.2Z" />
    </>
  ),
  'cloud-up': (
    <>
      <path
        className="alune-ic__duo"
        d="M7.5 18.5H7a4.3 4.3 0 1 1 .8-8.5A5.8 5.8 0 0 1 19.2 11a3.7 3.7 0 0 1-1.4 7.5Z"
      />
      <path d="M7.5 18.5H7a4.3 4.3 0 1 1 .8-8.5A5.8 5.8 0 0 1 19.2 11a3.7 3.7 0 0 1-1.4 7.5h-.8" />
      <path d="M12 12.5v7M9.6 14.8L12 12.4l2.4 2.4" />
    </>
  ),
  'cloud-down': (
    <>
      <path
        className="alune-ic__duo"
        d="M7.5 18.5H7a4.3 4.3 0 1 1 .8-8.5A5.8 5.8 0 0 1 19.2 11a3.7 3.7 0 0 1-1.4 7.5Z"
      />
      <path d="M7.5 18.5H7a4.3 4.3 0 1 1 .8-8.5A5.8 5.8 0 0 1 19.2 11a3.7 3.7 0 0 1-1.4 7.5h-.8" />
      <path d="M12 11.8v7.6M9.6 17l2.4 2.4 2.4-2.4" />
    </>
  ),
  plug: (
    <>
      <path className="alune-ic__duo" d="M6.8 8h10.4v3.2a5.2 5.2 0 0 1-10.4 0Z" />
      <path d="M9 3.8v4.2M15 3.8v4.2M6.8 8h10.4v3.2a5.2 5.2 0 0 1-10.4 0ZM12 16.4v4" />
    </>
  ),
  disconnect: (
    <>
      <path d="M9.5 14.5l-1.8 1.8a3.2 3.2 0 0 1-4.5-4.5l1.8-1.8M14.5 9.5l1.8-1.8a3.2 3.2 0 0 1 4.5 4.5L19 14" />
      <path d="M4.5 4.5l15 15" />
    </>
  ),
  apartment: (
    <>
      <rect className="alune-ic__duo" x="9" y="3.8" width="6" height="4.4" rx="1.8" />
      <rect className="alune-ic__duo" x="3.5" y="15.8" width="6" height="4.4" rx="1.8" />
      <rect className="alune-ic__duo" x="14.5" y="15.8" width="6" height="4.4" rx="1.8" />
      <rect x="9" y="3.8" width="6" height="4.4" rx="1.8" />
      <rect x="3.5" y="15.8" width="6" height="4.4" rx="1.8" />
      <rect x="14.5" y="15.8" width="6" height="4.4" rx="1.8" />
      <path d="M12 8.2v3.6M6.5 15.8v-1.8a2.2 2.2 0 0 1 2.2-2.2h6.6a2.2 2.2 0 0 1 2.2 2.2v1.8" />
    </>
  ),

  // --- Security & Identity ---
  lock: (
    <>
      <rect className="alune-ic__duo" x="5" y="10.2" width="14" height="10" rx="3.2" />
      <rect x="5" y="10.2" width="14" height="10" rx="3.2" />
      <path d="M8.5 10.2v-2.7a3.5 3.5 0 0 1 7 0v2.7" />
    </>
  ),
  key: (
    <>
      <circle className="alune-ic__duo" cx="8.2" cy="15.4" r="3.8" />
      <circle cx="8.2" cy="15.4" r="3.8" />
      <path d="M11 12.6L19 4.6M15.8 7.8l2.4 2.4M13.6 10l1.8 1.8" />
    </>
  ),
  shield: (
    <>
      <path
        className="alune-ic__duo"
        d="M12 3.5c2.4 1.3 4.8 2 7 2.2v5.4c0 4.5-2.8 7.7-7 9.4-4.2-1.7-7-4.9-7-9.4V5.7c2.2-.2 4.6-.9 7-2.2Z"
      />
      <path d="M12 3.5c2.4 1.3 4.8 2 7 2.2v5.4c0 4.5-2.8 7.7-7 9.4-4.2-1.7-7-4.9-7-9.4V5.7c2.2-.2 4.6-.9 7-2.2Z" />
      <path d="M9.2 12.2l2 2 3.8-4" />
    </>
  ),
  user: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="8.4" r="3.8" />
      <circle cx="12" cy="8.4" r="3.8" />
      <path d="M4.8 19.6c1.3-3.4 3.9-5.1 7.2-5.1s5.9 1.7 7.2 5.1" />
    </>
  ),
  mail: (
    <>
      <rect className="alune-ic__duo" x="3.5" y="5.5" width="17" height="13" rx="3.2" />
      <rect x="3.5" y="5.5" width="17" height="13" rx="3.2" />
      <path d="M4.5 7.5l7.5 5.4 7.5-5.4" />
    </>
  ),

  // --- Actions & Editing ---
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  'minus-square': (
    <>
      <rect className="alune-ic__duo" x="4" y="4" width="16" height="16" rx="4" />
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8.5 12h7" />
    </>
  ),
  search: (
    <>
      <circle className="alune-ic__duo" cx="11" cy="11" r="6.5" />
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8l4.2 4.2" />
    </>
  ),
  trash: (
    <>
      <path className="alune-ic__duo" d="M6.8 7.5l.8 10.6a2.2 2.2 0 0 0 2.2 2h4.4a2.2 2.2 0 0 0 2.2-2l.8-10.6Z" />
      <path d="M4.5 7h15M9.5 7V5.4A1.6 1.6 0 0 1 11.1 3.8h1.8a1.6 1.6 0 0 1 1.6 1.6V7" />
      <path d="M6.8 7l.8 11a2.2 2.2 0 0 0 2.2 2h4.4a2.2 2.2 0 0 0 2.2-2l.8-11M10.2 11v5M13.8 11v5" />
    </>
  ),
  pencil: (
    <>
      <path
        className="alune-ic__duo"
        d="M5 19l1-4.3L15.6 5.1a2 2 0 0 1 2.8 0l.5.5a2 2 0 0 1 0 2.8L9.3 18Z"
      />
      <path d="M5 19l1-4.3L15.6 5.1a2 2 0 0 1 2.8 0l.5.5a2 2 0 0 1 0 2.8L9.3 18Z" />
      <path d="M13.4 7.3l3.3 3.3" />
    </>
  ),
  copy: (
    <>
      <rect className="alune-ic__duo" x="8.8" y="8.8" width="11.2" height="11.2" rx="3" />
      <rect x="8.8" y="8.8" width="11.2" height="11.2" rx="3" />
      <path d="M15.2 8.8V6.6A2.6 2.6 0 0 0 12.6 4H6.6A2.6 2.6 0 0 0 4 6.6v6a2.6 2.6 0 0 0 2.6 2.6h2.2" />
    </>
  ),
  eye: (
    <>
      <path
        className="alune-ic__duo"
        d="M2.8 12S6.2 6 12 6s9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z"
      />
      <path d="M2.8 12S6.2 6 12 6s9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4.2 4.2l15.6 15.6M9.9 6.2A9.5 9.5 0 0 1 12 6c5.8 0 9.2 6 9.2 6a16 16 0 0 1-2.6 3.2" />
      <path d="M6.4 7.6C4 9.2 2.8 12 2.8 12S6.2 18 12 18a9.2 9.2 0 0 0 4.5-1.2M10 10a2.8 2.8 0 0 0 4 4" />
    </>
  ),
  link: (
    <path d="M10.2 13.8a3.8 3.8 0 0 0 5.4 0l2.8-2.8a3.8 3.8 0 0 0-5.4-5.4l-1.1 1.1M13.8 10.2a3.8 3.8 0 0 0-5.4 0L5.6 13a3.8 3.8 0 0 0 5.4 5.4l1.1-1.1" />
  ),
  swap: <path d="M4.8 8.5h14.4M15.2 5l3.6 3.5-3.6 3.5M19.2 15.5H4.8M8.8 12l-3.6 3.5L8.8 19" />,
  download: <path d="M12 4.5v10.8M7.8 11.2L12 15.4l4.2-4.2M4.8 19.2h14.4" />,
  upload: <path d="M12 15.3V4.5M7.8 8.7L12 4.5l4.2 4.2M4.8 19.2h14.4" />,
  export: (
    <>
      <path d="M14.5 4.5h4.8v4.8M19.2 4.8L11.5 12.5" />
      <path d="M19 13.5v3.2a2.8 2.8 0 0 1-2.8 2.8H7.3a2.8 2.8 0 0 1-2.8-2.8V7.8A2.8 2.8 0 0 1 7.3 5h3.2" />
    </>
  ),
  expand: <path d="M14.5 4.5h5v5M19.2 4.8L14 10M9.5 19.5h-5v-5M4.8 19.2L10 14" />,
  compress: <path d="M19.5 9.5h-5v-5M14.8 9.2L20 4M4.5 14.5h5v5M9.2 14.8L4 20" />,
  clear: (
    <>
      <path
        className="alune-ic__duo"
        d="M5.5 14.5l6.8-6.8a2.2 2.2 0 0 1 3.1 0l3.1 3.1a2.2 2.2 0 0 1 0 3.1l-4.6 4.6H8.5Z"
      />
      <path d="M5.5 14.5l6.8-6.8a2.2 2.2 0 0 1 3.1 0l3.1 3.1a2.2 2.2 0 0 1 0 3.1l-4.6 4.6H8.5l-3-3Z" />
      <path d="M4.5 18.5h15" />
    </>
  ),
  pause: (
    <>
      <rect className="alune-ic__duo" x="6" y="5" width="4.2" height="14" rx="2" />
      <rect className="alune-ic__duo" x="13.8" y="5" width="4.2" height="14" rx="2" />
      <rect x="6" y="5" width="4.2" height="14" rx="2" />
      <rect x="13.8" y="5" width="4.2" height="14" rx="2" />
    </>
  ),
  aim: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 3.2v2.3M12 18.5v2.3M3.2 12h2.3M18.5 12h2.3" />
    </>
  ),
  select: (
    <>
      <path className="alune-ic__duo" d="M13 13l7 2.5-3 1.5-1.5 3Z" />
      <path d="M5 9V7a2 2 0 0 1 2-2h2M15 5h2a2 2 0 0 1 2 2v2M5 15v2a2 2 0 0 0 2 2h2" />
      <path d="M13 13l7 2.5-3 1.5-1.5 3Z" />
    </>
  ),

  // --- Layout, Views & Controls ---
  settings: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="7.2" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.8v2M12 18.2v2M5.5 7.2l1.6 1M16.9 15.8l1.6 1M18.5 7.2l-1.6 1M7.1 15.8l-1.6 1" />
      <circle cx="12" cy="12" r="7.4" strokeDasharray="2.4 3.4" />
    </>
  ),
  sliders: (
    <>
      <circle className="alune-ic__duo" cx="15" cy="7.5" r="2.2" />
      <circle className="alune-ic__duo" cx="9" cy="16.5" r="2.2" />
      <path d="M4.2 7.5h8.6M17.2 7.5h2.6M4.2 16.5h2.6M11.2 16.5h8.6" />
      <circle cx="15" cy="7.5" r="2.2" />
      <circle cx="9" cy="16.5" r="2.2" />
    </>
  ),
  columns: (
    <>
      <rect className="alune-ic__duo" x="3.5" y="4.5" width="17" height="15" rx="3.5" />
      <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
      <path d="M9.2 4.5v15M14.8 4.5v15" />
    </>
  ),
  layout: (
    <>
      <rect className="alune-ic__duo" x="3.5" y="4.5" width="17" height="15" rx="3.5" />
      <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
      <path d="M3.5 9.8h17M9.5 9.8v9.7" />
    </>
  ),
  appstore: (
    <>
      <rect className="alune-ic__duo" x="4" y="4" width="6.5" height="6.5" rx="2.2" />
      <rect className="alune-ic__duo" x="13.5" y="4" width="6.5" height="6.5" rx="2.2" />
      <rect className="alune-ic__duo" x="4" y="13.5" width="6.5" height="6.5" rx="2.2" />
      <rect className="alune-ic__duo" x="13.5" y="13.5" width="6.5" height="6.5" rx="2.2" />
      <rect x="4" y="4" width="6.5" height="6.5" rx="2.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="2.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="2.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2.2" />
    </>
  ),
  'unordered-list': (
    <>
      <path d="M9 7h10.5M9 12h10.5M9 17h10.5" />
      <circle cx="5" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  'bar-chart': (
    <>
      <rect className="alune-ic__duo" x="4.5" y="12" width="3.8" height="7.5" rx="1.6" />
      <rect className="alune-ic__duo" x="10.1" y="5" width="3.8" height="14.5" rx="1.6" />
      <rect className="alune-ic__duo" x="15.7" y="9" width="3.8" height="10.5" rx="1.6" />
      <rect x="4.5" y="12" width="3.8" height="7.5" rx="1.6" />
      <rect x="10.1" y="5" width="3.8" height="14.5" rx="1.6" />
      <rect x="15.7" y="9" width="3.8" height="10.5" rx="1.6" />
    </>
  ),
  profile: (
    <>
      <rect className="alune-ic__duo" x="4" y="4.5" width="16" height="15" rx="3.5" />
      <rect x="4" y="4.5" width="16" height="15" rx="3.5" />
      <path d="M8 9.2h8M8 13h8M8 16.5h4.5" />
    </>
  ),
  skin: (
    <>
      <path
        className="alune-ic__duo"
        d="M8.5 5.2a3.5 3.5 0 0 0 7 0l3.8 2.2-1.8 4-2.2-1v8.8a1.8 1.8 0 0 1-1.8 1.8h-3a1.8 1.8 0 0 1-1.8-1.8v-8.8l-2.2 1-1.8-4Z"
      />
      <path d="M8.5 5.2a3.5 3.5 0 0 0 7 0l3.8 2.2-1.8 4-2.2-1v8.8a1.8 1.8 0 0 1-1.8 1.8h-3a1.8 1.8 0 0 1-1.8-1.8v-8.8l-2.2 1-1.8-4Z" />
    </>
  ),
  chat: (
    <>
      <path
        className="alune-ic__duo"
        d="M4.5 18.8V7.2a2.8 2.8 0 0 1 2.8-2.8h9.4a2.8 2.8 0 0 1 2.8 2.8v6.6a2.8 2.8 0 0 1-2.8 2.8H8.4Z"
      />
      <path d="M4.5 18.8V7.2a2.8 2.8 0 0 1 2.8-2.8h9.4a2.8 2.8 0 0 1 2.8 2.8v6.6a2.8 2.8 0 0 1-2.8 2.8H8.4Z" />
      <path d="M8.5 9.2h7M8.5 12.6h4.2" />
    </>
  ),
  dots: (
    <>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  holder: (
    <>
      <circle cx="9" cy="6.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17.5" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.8V12l3 2" />
    </>
  ),
  moon: (
    <>
      <path
        className="alune-ic__duo"
        d="M19.2 14.4A7.6 7.6 0 0 1 9.6 4.8a7.6 7.6 0 1 0 9.6 9.6Z"
      />
      <path d="M19.2 14.4A7.6 7.6 0 0 1 9.6 4.8a7.6 7.6 0 1 0 9.6 9.6Z" />
    </>
  ),
  sun: (
    <>
      <circle className="alune-ic__duo" cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" />
    </>
  ),
  wave: <path d="M3 12c1.5-3.2 3-3.2 4.5 0s3 3.2 4.5 0 3-3.2 4.5 0 3 3.2 4.5 0" />,
} satisfies Record<string, ReactNode>;

export type AluneIconName = keyof typeof aluneIconPaths;

export interface AluneIconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  name: AluneIconName;
  spin?: boolean;
  rotate?: number;
  monoline?: boolean;
  svgProps?: Omit<SVGProps<SVGSVGElement>, 'children'>;
}

/**
 * Drop-in Peach Duotone icon rendered in an `.anticon` span so existing layout,
 * Ant Design `<Button icon={...}>`, and toolbar/sidebar selectors align seamlessly.
 */
export function AluneIcon({
  name,
  spin = false,
  rotate,
  monoline = false,
  className,
  style,
  svgProps,
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
  ...rest
}: AluneIconProps) {
  const classes = [
    'anticon',
    'alune-icon',
    spin ? 'anticon-spin alune-icon--spin' : '',
    monoline ? 'alune-icon--monoline' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const svgStyle =
    rotate !== undefined
      ? {
          ...svgProps?.style,
          transform: `rotate(${rotate}deg)`,
          transition: 'transform 160ms var(--ease-enter, ease)',
        }
      : svgProps?.style;

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? ariaHidden : (ariaHidden ?? true)}
      className={classes}
      style={style}
      {...rest}
    >
      <svg
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        focusable="false"
        aria-hidden="true"
        {...svgProps}
        style={svgStyle}
      >
        {aluneIconPaths[name]}
      </svg>
    </span>
  );
}
