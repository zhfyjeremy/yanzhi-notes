import { useState } from "react";
import { YanzhiEditor } from "./editor/YanzhiEditor";

/** M1 骨架页:正式编辑器组件 + 方言全覆盖示例文档;自动保存状态栏为 M3 预留演示 */

const SAMPLE_MD = `# 砚知笔记

统一 Schema 的正式编辑器组件(M1):内容经 markdown-it 解析进入,序列化单路径写出。

## 基础格式

**粗体**、*斜体*、<u>下划线</u>、~~删除线~~、\`行内代码\`、==高亮==、[链接](https://example.com)

## 列表

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

| 表格 | 对齐 |
| :--- | :---: |
| 左对齐 | 居中 |

\`\`\`ts
const yanzhi = { local: true, offline: "by default" };
\`\`\`

---
`;

function App() {
  const [savedAt, setSavedAt] = useState<string>("");

  return (
    <main className="bg-background text-foreground flex h-screen flex-col">
      <YanzhiEditor markdown={SAMPLE_MD} onMarkdownChange={() => {
        const now = new Date();
        setSavedAt(
          `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
        );
      }} />
      <footer className="text-muted-foreground flex h-7 shrink-0 items-center justify-end border-t px-3 text-xs">
        {savedAt ? `已自动保存 ${savedAt}` : "就绪"}
      </footer>
    </main>
  );
}

export default App;
