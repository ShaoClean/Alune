import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { changeActions, type FileStatus } from '@alune/domain';

const keyOf = (file: FileStatus) => (file.staged ? 'staged:' : 'unstaged:') + file.path;

export function canSelectChange(file: FileStatus) {
  const actions = changeActions(file);
  return (
    !file.conflicted &&
    file.status !== 'ignored' &&
    (actions.stage || actions.unstage || actions.discard)
  );
}

export function useChangeSelection(visible: FileStatus[]) {
  const [keys, setKeys] = useState(() => new Set<string>());
  const anchor = useRef<string | null>(null);
  const selectable = useMemo(() => visible.filter(canSelectChange), [visible]);

  // Forget hidden rows even if a later refresh or filter brings the same path back.
  useLayoutEffect(() => {
    const valid = new Set(selectable.map(keyOf));
    if (anchor.current && !valid.has(anchor.current)) anchor.current = null;
    setKeys((previous) => {
      const remaining = new Set([...previous].filter((key) => valid.has(key)));
      return remaining.size === previous.size ? previous : remaining;
    });
  }, [selectable]);

  function mark(files: FileStatus[], checked: boolean) {
    setKeys((previous) => {
      const next = new Set(previous);
      for (const file of files) {
        if (checked) next.add(keyOf(file));
        else next.delete(keyOf(file));
      }
      return next;
    });
  }

  const isChecked = (file: FileStatus) => keys.has(keyOf(file));
  function toggle(file: FileStatus, range: boolean) {
    const key = keyOf(file);
    if (range && anchor.current) {
      const group = selectable.filter((row) => row.staged === file.staged);
      const start = group.findIndex((row) => keyOf(row) === anchor.current);
      const end = group.findIndex((row) => keyOf(row) === key);
      if (start >= 0 && end >= 0) {
        mark(group.slice(Math.min(start, end), Math.max(start, end) + 1), true);
        return;
      }
    }
    anchor.current = key;
    mark([file], !isChecked(file));
  }

  function toggleGroup(files: FileStatus[]) {
    anchor.current = null;
    mark(files, !files.every(isChecked));
  }

  function clear() {
    anchor.current = null;
    setKeys(new Set());
  }

  return {
    selected: selectable.filter(isChecked),
    isChecked,
    toggle,
    toggleGroup,
    anchorAt: (file: FileStatus) => {
      anchor.current = keyOf(file);
    },
    clear,
    remove: (files: FileStatus[]) => mark(files, false),
  };
}
