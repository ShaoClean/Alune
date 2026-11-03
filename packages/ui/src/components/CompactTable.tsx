import { useRef } from 'react';
import type { CSSProperties, Key, KeyboardEvent, ReactNode } from 'react';

export interface CompactTableColumn<T> {
  /** Stable column identifier. */
  key: string;
  title: ReactNode;
  width?: CSSProperties['width'];
  align?: 'left' | 'center' | 'right';
  /** Display-only content in the first column; other columns may contain actions. */
  render: (item: T) => ReactNode;
}

export interface CompactTableGroup<T> {
  key: Key;
  label: ReactNode;
  /** Items in display order; empty groups are omitted. */
  items: readonly T[];
}

export interface CompactTableProps<T> {
  label: string;
  /** Ordered data columns, excluding the merged group heading. */
  columns: readonly CompactTableColumn<T>[];
  /** Ordered groups; filtering and sorting belong to the host. */
  groups: readonly CompactTableGroup<T>[];
  /** Stable, globally unique row key. */
  rowKey: (item: T) => Key;
  /** Complete accessible identity for the row button. */
  rowLabel: (item: T) => string;
  /** Controlled selection. The host reconciles it after filtering. */
  selectedKey?: Key;
  /** Click, Space, or arrow-key selection. */
  onSelect?: (item: T) => void;
  /** Enter or double-click activation. */
  onActivate?: (item: T) => void;
  /** Heading of the merged grouping column. */
  groupHeading?: ReactNode;
  /** Width of the merged grouping column. */
  groupWidth?: CSSProperties['width'];
  /** Content displayed when every group is empty. */
  empty?: ReactNode;
  className?: string;
}

/** Native table semantics; the first column owns the keyboard-selectable row button. */
export function CompactTable<T>({
  label,
  columns,
  groups,
  rowKey,
  rowLabel,
  selectedKey,
  onSelect,
  onActivate,
  groupHeading = '分组',
  groupWidth = 104,
  empty = '暂无数据',
  className = '',
}: CompactTableProps<T>) {
  const table = useRef<HTMLTableElement>(null);
  const populated = groups.filter((group) => group.items.length > 0);
  const items = populated.flatMap((group) => [...group.items]);
  const keyboardSelect = (event: KeyboardEvent<HTMLButtonElement>, item: T) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Enter' && onActivate) {
      event.preventDefault();
      onActivate(item);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = items.findIndex((row) => rowKey(row) === rowKey(item));
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    table.current?.querySelectorAll<HTMLButtonElement>('[data-compact-row-button]')[next]?.focus();
    onSelect?.(items[next]);
  };
  return (
    <div
      className={`compact-table-scroll${className ? ` ${className}` : ''}`}
      role="region"
      aria-label={`${label}，可横向滚动`}
      tabIndex={0}
    >
      <table ref={table} className="compact-table" aria-label={label}>
        <colgroup>
          <col style={{ width: groupWidth }} />
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{groupHeading}</th>
            {columns.map((column) => (
              <th key={column.key} scope="col" style={{ textAlign: column.align }}>
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        {populated.map((group) => (
          <tbody key={group.key}>
            {group.items.map((item, index) => (
              <tr
                key={rowKey(item)}
                className={rowKey(item) === selectedKey ? 'compact-table__selected' : undefined}
                onClick={(event) => {
                  if (
                    !(event.target as HTMLElement).closest(
                      'button, a, input, select, textarea, th[scope="rowgroup"]',
                    )
                  )
                    onSelect?.(item);
                }}
                onDoubleClick={(event) => {
                  if (
                    !(event.target as HTMLElement).closest(
                      'button, a, input, select, textarea, th[scope="rowgroup"]',
                    )
                  )
                    onActivate?.(item);
                }}
              >
                {index === 0 && (
                  <th
                    scope="rowgroup"
                    rowSpan={group.items.length}
                    className="compact-table__group"
                  >
                    {group.label}
                  </th>
                )}
                {columns.map((column, columnIndex) =>
                  columnIndex === 0 ? (
                    <th key={column.key} scope="row">
                      {onSelect || onActivate ? (
                        <button
                          type="button"
                          data-compact-row-button
                          className="compact-table__row-button"
                          aria-label={rowLabel(item)}
                          aria-pressed={onSelect ? rowKey(item) === selectedKey : undefined}
                          onClick={() => onSelect?.(item)}
                          onDoubleClick={() => onActivate?.(item)}
                          onKeyDown={(event) => keyboardSelect(event, item)}
                        >
                          {column.render(item)}
                        </button>
                      ) : (
                        column.render(item)
                      )}
                    </th>
                  ) : (
                    <td key={column.key} style={{ textAlign: column.align }}>
                      {column.render(item)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        ))}
        {!items.length && (
          <tbody>
            <tr>
              <td className="compact-table__empty" colSpan={columns.length + 1}>
                {empty}
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}
