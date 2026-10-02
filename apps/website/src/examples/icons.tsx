import { FileIcon, FolderIcon, DialogIcon } from '@alune/ui';

export default function Example() {
  return (
    <div className="example">
      <section className="example-group">
        <h2 className="example-title">文件类型</h2>
        <div className="example-icon-grid">
          {['main.ts', 'view.tsx', 'package.json', 'README.md', 'photo.png', 'unknown.file'].map(
            (path) => (
              <div key={path} className="example-icon-item">
                <FileIcon path={path} />
                <span>{path}</span>
              </div>
            ),
          )}
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">目录与仓库</h2>
        <div className="example-icon-grid">
          <div className="example-icon-item">
            <FolderIcon />
            <span>文件夹</span>
          </div>
          <div className="example-icon-item">
            <FolderIcon open />
            <span>已展开</span>
          </div>
          <div className="example-icon-item">
            <FolderIcon variant="repository" />
            <span>仓库</span>
          </div>
          <div className="example-icon-item">
            <FolderIcon variant="link" />
            <span>链接</span>
          </div>
        </div>
      </section>
      <section className="example-group">
        <h2 className="example-title">操作图标</h2>
        <div className="example-icon-grid">
          {(['folder', 'clock', 'check', 'x', 'refresh'] as const).map((name) => (
            <div key={name} className="example-icon-item">
              <DialogIcon name={name} />
              <span>{name}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
