import type { ReactNode } from 'react';

/** Diff view switches: one pane with full-width rows versus two panes split by a divider. */
function ViewIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="diff-view-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      {children}
    </svg>
  );
}

export function UnifiedViewIcon() {
  return (
    <ViewIcon>
      <path d="M7 9h10M7 12.5h10M7 16h6" />
    </ViewIcon>
  );
}

export function SplitViewIcon() {
  return (
    <ViewIcon>
      <path d="M12 4v16" />
      <path d="M6 9.5h3M6 14h3M15 9.5h3M15 14h3" />
    </ViewIcon>
  );
}
