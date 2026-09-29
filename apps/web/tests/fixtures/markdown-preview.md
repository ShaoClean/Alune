# Markdown 预览

中文文档，支持 **粗体**、*斜体*、~~删除线~~和 `行内代码`。

[文档锚点](#资源规则) · [子文档](docs/guide.MD#中文标题) · [外部链接](https://example.com/)

## 列表与引用

- 普通列表
  - 嵌套项目
- [x] 已完成的只读任务
- [ ] 未完成的只读任务

1. 第一步
2. 第二步

> 引用内容：切换显示模式不会修改文件。

---

| 功能 | 状态 | 说明 |
| :--- | :---: | ---: |
| 本地仓库 | 支持 | 工作区文件 |
| SSH 仓库 | 支持 | 工作区文件 |

```markdown
# 这里仍然是源码
**literal** [link](javascript:alert(1)) | table |
<script>alert('code only')</script>
```

    # 缩进代码也不会变成标题

## 资源规则

![仓库图片](assets/sample.png)

![缺失图片](assets/missing.png)

![不支持的图片](assets/vector.svg)

![符号链接图片](assets/link.png)

![外部图片](https://example.invalid/tracker.png)

[危险链接](javascript:alert%281%29) · [越界链接](../outside.md) · [.git 链接](.git/config)

<script>window.markdownExecuted = true</script>

<img src="https://example.invalid/raw.png" onerror="window.markdownExecuted = true">

## 中文标题

标题支持中文锚点。

## 中文标题

重复标题使用独立锚点。
