import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";
import { YanzhiEditor } from "./editor/YanzhiEditor";
import { TocPanel } from "./editor/panel/TocPanel";

/** M2 骨架页:编辑器 + 右栏 TOC;左栏目录树随 M3 知识库接入 */

const SAMPLE_MD = `# 砚知笔记

统一 Schema 的正式编辑器组件(M1):内容经 markdown-it 解析进入,序列化单路径写出。

## 基础格式

**粗体**、*斜体*、<u>下划线</u>、~~删除线~~、\`行内代码\`、==高亮==、[链接](https://example.com)

## 列表与待办

- 无序列表
- 嵌套子项
  - 更深一层

1. 有序列表
2. 第二项

- [ ] 待办事项
- [x] 已完成

## 双链与引用

关联 [[开始使用]] 文档。

> 引用块:语雀同款左蓝边样式。

### 表格

| 表格 | 对齐 |
| :--- | :---: |
| 左对齐 | 居中 |

### 图片

![示意图](/placeholder.svg)

### 文字颜色

<font color="#e05c5c">红色警示</font>、<font color="#4ea832">绿**加粗**</font> 与 <font color="#3b82f6">蓝色说明</font>。

### 代码块

\`\`\`ts
const yanzhi = { local: true, offline: "by default" };
\`\`\`

---

## 界面

顶部工具栏与斜杠菜单在 M1 交付;右侧大纲面板可折叠,点击标题跳转。
`;

function App() {
  const [savedAt, setSavedAt] = useState<string>("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const handleReady = useCallback((e: Editor) => setEditor(e), []);
  const handleScrollRef = useCallback((el: HTMLDivElement | null) => setScrollEl(el), []);

  return (
    <main className="bg-background text-foreground flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <YanzhiEditor
          markdown={SAMPLE_MD}
          onReady={handleReady}
          scrollContainerRef={handleScrollRef}
          onMarkdownChange={() => {
            const now = new Date();
            setSavedAt(
              `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
            );
          }}
        />
        {editor && <TocPanel editor={editor} scrollContainer={scrollEl} />}
      </div>
      <footer className="text-muted-foreground flex h-7 shrink-0 items-center justify-end px-3 text-xs">
        {savedAt ? `已自动保存 ${savedAt}` : "就绪"}
      </footer>
    </main>
  );
}

export default App;
