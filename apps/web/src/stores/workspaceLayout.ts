export interface LayoutPreferences {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  changesWidth: number;
}

export const DEFAULT_LAYOUT: LayoutPreferences = {
  sidebarCollapsed: false,
  sidebarWidth: 220,
  changesWidth: 340,
};
export const SIDEBAR_MIN = 184;
export const SIDEBAR_MAX = 320;
export const CHANGES_MIN = 280;
export const CHANGES_MAX = 520;
export const INSPECTOR_MIN = 360;
export const RESIZE_WIDTH = 4;
export const COMPACT_WIDTH = 900;

export function clampWidth(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function readLayoutPreferences(value: unknown): LayoutPreferences {
  const saved = value && typeof value === 'object' ? (value as Partial<LayoutPreferences>) : {};
  const width = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? clampWidth(value, min, max) : fallback;
  return {
    sidebarCollapsed: typeof saved.sidebarCollapsed === 'boolean' ? saved.sidebarCollapsed : false,
    sidebarWidth: width(saved.sidebarWidth, DEFAULT_LAYOUT.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX),
    changesWidth: width(saved.changesWidth, DEFAULT_LAYOUT.changesWidth, CHANGES_MIN, CHANGES_MAX),
  };
}

// Fitting the window never changes the saved preference; expanding restores it.
export function fitWorkspaceLayout(saved: LayoutPreferences, windowWidth: number) {
  const compact = windowWidth < COMPACT_WIDTH;
  const sidebarMax = Math.min(
    SIDEBAR_MAX,
    Math.max(SIDEBAR_MIN, windowWidth - CHANGES_MIN - INSPECTOR_MIN - RESIZE_WIDTH),
  );
  const sidebarWidth = compact ? saved.sidebarWidth : Math.min(saved.sidebarWidth, sidebarMax);
  const sidebarSpace = compact ? 0 : saved.sidebarCollapsed ? 52 : sidebarWidth;
  const changesMax = Math.min(
    CHANGES_MAX,
    Math.max(CHANGES_MIN, windowWidth - sidebarSpace - INSPECTOR_MIN - RESIZE_WIDTH),
  );
  return {
    compact,
    sidebarWidth,
    sidebarMax,
    changesWidth: Math.min(saved.changesWidth, changesMax),
    changesMax,
  };
}
