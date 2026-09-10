# RemoteGit v0.2.1

本次更新改进了 **版本更新体验**，并修复了 *长内容阅读* 问题。

## 新功能

- 支持 Markdown 更新说明。
  - 保留嵌套列表与 `行内代码`。
  - 阅读 [完整变更](https://github.com/ShaoClean/remote-git/compare/v0.2.0...v0.2.1)。
- ~~直接展示 Markdown 原文~~。

## 升级步骤

1. 检查更新。
2. 下载新版本。
   1. 等待校验完成。
   2. 使用现有安装入口。

> 更新说明可独立滚动，版本信息与操作按钮保持可见。

### 代码示例

执行 `git log --format="**%s**"`，代码中的 Markdown 字符保持原样：

```sh
# This is a code comment, not a heading
printf '**literal** [link](https://example.com) | table |'
git log --format="%H %s" -- https://example.com/a/very/long/path/that/must/stay/inside/the/code/block/without/stretching/the/update/dialog
```

### 平台支持

| 平台 | 安装方式 | 说明 |
| :--- | :---: | ---: |
| macOS | 重启安装 | 保留现有交互 |
| Windows / Linux | 重启安装 | 保留现有交互 |

### 宽表格

| 平台 | 文件名 | 校验摘要 | 下载通道 | 发布类型 | 备注 |
| --- | --- | --- | --- | --- | --- |
| macOS | RemoteGit-desktop-universal.dmg | abcdef0123456789abcdef0123456789abcdef0123456789 | GitHub Releases | stable | 表格支持横向滚动 |

### 长链接

<https://github.com/ShaoClean/remote-git/releases/tag/this-is-a-long-release-reference-that-should-wrap-within-the-notes-panel-without-expanding-the-dialog>

### 维护事项

- [x] 检查更新说明的排版。
- [ ] 下载完成后使用现有安装入口。

普通文本段落也可以正常阅读，更新说明最后一段仍在独立滚动区域内。
