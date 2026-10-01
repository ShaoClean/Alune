import { FileIcon, FolderIcon, DialogIcon, Space } from '@alune/ui';

export default function Example() {
  return (
    <>
      <Space wrap>
        {['main.ts', 'view.tsx', 'package.json', 'README.md', 'photo.png', 'unknown.file'].map(
          (path) => (
            <span key={path} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <FileIcon path={path} />
              {path}
            </span>
          ),
        )}
      </Space>
      <Space wrap>
        <FolderIcon />
        <span>文件夹</span>
        <FolderIcon open />
        <span>已展开</span>
        <FolderIcon variant="repository" />
        <span>仓库</span>
        <FolderIcon variant="link" />
        <span>链接</span>
      </Space>
      <Space wrap>
        {(['folder', 'clock', 'check', 'x', 'refresh'] as const).map((name) => (
          <span key={name}>
            <DialogIcon name={name} />
            {name}
          </span>
        ))}
      </Space>
    </>
  );
}
