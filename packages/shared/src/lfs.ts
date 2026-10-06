export interface LfsPointer {
  oid: string;
  size: number;
}

// Pointer files are small UTF-8 documents, never arbitrary matching fragments.
export function parseLfsPointer(text: string): LfsPointer | null {
  if (text.length > 1024) return null;
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines[0] !== 'version https://git-lfs.github.com/spec/v1') return null;
  const oid = lines.find((line) => /^oid sha256:[a-f0-9]{64}$/.test(line));
  const size = lines.find((line) => /^size (0|[1-9][0-9]*)$/.test(line));
  if (
    !oid ||
    !size ||
    lines.filter((line) => line.startsWith('oid ')).length !== 1 ||
    lines.filter((line) => line.startsWith('size ')).length !== 1 ||
    lines.slice(1).some((line) => line !== oid && line !== size && !/^ext-\d+-\S+ \S+$/.test(line))
  )
    return null;
  const bytes = Number(size.slice(5));
  return Number.isSafeInteger(bytes) ? { oid: oid.slice(11), size: bytes } : null;
}

export interface LfsStatus {
  used: boolean;
  installed: boolean;
  version?: string;
  message?: string;
}

export interface SubmoduleInfo {
  path: string;
  recordedCommit: string;
  currentCommit: string | null;
  initialized: boolean;
  dirty: boolean;
  status: 'uninitialized' | 'current' | 'changed' | 'conflict';
}
