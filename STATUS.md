# 项目状态(更新:2026-10-29)

> 开工前速览:看「下一步」直接干活;细节翻 PRD 对应章节。

## 现状一句话

**M2 卡片与面板全部完成(工作区未提交)**:TOC、代码块卡片、Shiki 高亮、表格工具条、粘贴清洗、图片卡片 UI。下一步 M3 知识库与系统。

## 里程碑(PRD §11.4 工期表)

### M1 编辑器内核 ✅ 已完成(d19d44e)

统一 Schema、YanzhiEditor 组件(md 进/md 出单路径)、格式工具栏、斜杠菜单、md 往返 fixtures 14/14。
基础轮子:阶段 0 往返管线(e828162)、块编辑模式移除(PRD v1.5,9eb6d7d)、macOS 右键菜单汉化(Info.plist)。

### M2 卡片与面板 🔨 进行中

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| TOC 大纲面板 | ✅ 工作区未提交 | 滚动高亮联动、点击跳转、可折叠 |
| 代码块卡片 | ✅ 工作区未提交 | hover 语言切换/复制、行号列;`src/editor/extensions/code-block-card.tsx` |
| Shiki 语法高亮 | ✅ 工作区未提交 | `src/editor/extensions/code-highlight.ts`,PM decoration + css-variables 语义槽位 → `--code-*` token |
| 表格编辑工具条 | ✅ 工作区未提交 | 光标入表浮现:行/列增删下拉 + 整列对齐 + 删表;`table-utils.ts` + `toolbar/TableToolbar.tsx` + 表格基础样式 |
| 粘贴清洗 | ✅ 工作区未提交 | `paste-clean.ts`(transformPastedHTML):样式/脚本/私有 XML 丢弃、追踪参数剥离、合并表格降级纯文本、外部任务列表转 taskItem、外部颜色吸附预设色 |
| 图片卡片 UI | ✅ 工作区未提交 | 选中图片浮层(宽度/对齐/放大 lightbox);width/align 是会话级视图属性不进 md,持久化随 M3 方言确认 |
| 文字颜色(语雀式色卡) | ✅ 工作区未提交 | §10 方言 `<font color>`:色卡 8 色 + 默认清除(`extensions/font-color.ts` + 工具栏 Palette 下拉);粘贴吸附(黑白灰摘除/彩色吸附最近预设色);序列化公共 mark 外提 |

注:PRD 把「[[双链]]+跳转/前进后退」也列在 M2,但跳转依赖知识库文件系统,**挪到 M3 与目录树一起做**。

### M3 知识库与系统 ❌ 未开始

目录树左栏、[[双链]] 跳转/前进后退、标题↔文件名同步、重名规则、assets 落盘、自动保存与外部监听、回收站/认领、全局搜索、导入导出、macOS 授权。

## 工作区未提交变更(M2 全部)

- 新增:`src/editor/extensions/code-block-card.tsx`、`src/editor/extensions/code-highlight.ts`、`src/editor/extensions/image-card.tsx`、`src/editor/extensions/font-color.ts`、`src/editor/panel/TocPanel.tsx`、`src/editor/panel/ImageLightbox.tsx`、`src/editor/table-utils.ts`、`src/editor/paste-clean.ts`、`src/editor/toolbar/TableToolbar.tsx`、`src/editor/toolbar/ImageToolbar.tsx`、`src/editor/__tests__/table-utils.test.ts`、`src/editor/__tests__/paste-clean.test.ts`、`src/editor/__tests__/font-color.test.ts`、`public/placeholder.svg`
- 修改:`extensions.ts`(挂 CodeBlockCard/ImageCard/FontColor)、`editor.css`/`index.css`(卡片样式 + `--code-*` 语法色 + 表格/图片样式)、`App.tsx`/`YanzhiEditor.tsx`(TOC 接线、浮层锚点、粘贴清洗接入)、`markdown/serialize.ts`(fontColor 方言 + 公共 mark 外提)、`markdown/__tests__/fixtures/dialect.md`(颜色往返用例)、`slash-command/index.tsx`(浮层间距)、`toolbar/EditorToolbar.tsx`(表格/图片按钮 + 色卡下拉 + 去边线)、`package.json`(shiki、@shikijs/langs、@shikijs/engine-javascript、@tiptap/suggestion、@tiptap/extension-code-block)、PRD(§5.3/§5.7/§10 文字颜色)
- **M2 可整体提交**

## 下一步开工(M3 知识库与系统,PRD §11.4)

1. 目录树左栏(文件系统基于 Tauri fs API,`.yanzhi/` 元数据)
2. [[双链]] 跳转/前进后退(依赖目录树;重名强制路径写法)
3. 标题↔文件名同步、重名规则、assets 落盘(图片粘贴/拖拽写盘 + 相对路径改写)
4. 自动保存与外部监听、回收站/认领、全局搜索(FlexSearch bigram)、导入导出、macOS 授权

## 踩过的坑(新代码前必读)

- **React 18 + shadcn new-CLI 组件**:新 CLI 生成的组件无 forwardRef(React 19 风格),radix `asChild` 的 ref 传递会断,popover/dropdown 定位失效。`button.tsx` 已手工包了 forwardRef;**之后每次 `shadcn add` 都要检查**
- **flex 滚动**:任何 `flex-1` 滚动容器必须配 `min-h-0`,否则内容把 body 顶出滚动条;整页已设 `body overflow:hidden`,编辑列用 `min-h-0 flex-1`
- **装新依赖后必须重启 dev**:Vite optimizeDeps 在启动时定型,不重启会 resolve 失败(报错像没装一样)
- **Shiki**:必须传 theme(css-variables 占位主题)token 才会细分,否则整行一个 token;`@shikijs/langs`/`@shikijs/engine-javascript` 是直接依赖(pnpm 严格解析),新语言在 `code-highlight.ts` 的 `LANG_IMPORTS` 加字面量 import
- **@tiptap/suggestion 3.32**:`allowedPrefixes: null` 才能任意位置触发;浮层定位的 `fixed` 和 left/top 必须在同一个元素上
- **PM 位置算术**(table-utils 踩过):`$from.node(depth)` 的父级在 `depth-1` 不是 `depth+1`;`setNodeMarkup(pos)` 要求 `doc.nodeAt(pos)` 命中目标节点——单元格自身位置 = 表格内容起点(tablePos+1)+ 行偏移 + 行开标签 1 + 行内偏移,整体比直觉多 1
- **无浏览器工具时的 UI 验证**:`chromium-cli` 不在时,`/tmp/yanzhi-drive` 里有 playwright-core + 系统 Chrome(`channel:"chrome"`)驱动脚本,`pnpm dev` 起来后 `node drive.js` 可复用
- **updateAttributes 空区间**:collapsed TextSelection 下 `updateAttributes` 按 `[from,to)` 找节点,空区间命不中目标且**不报错**;浮层按钮链路要先 `setNodeSelection(pos)`(ImageToolbar 踩过)
- **jsdom 的 innerHTML 会把 U+00A0 序列化成 `&nbsp;` 实体文本**,文本级 `split("nbsp字符")` 匹配不到,实体和字符两种形态都要处理(paste-clean 踩过)
- **radix 菜单会移动焦点,PM 失焦期间不消费 DOM 选区变化**:菜单类(trigger+item)对行内 mark 的操作不能依赖 `chain().focus()` 恢复选区——`onOpenChange(true)` 时快照 `editor.state.selection`,命令前 `setTextSelection(快照)`;trigger 加 `onMouseDown preventDefault`。菜单打开瞬间焦点在 content 上,关闭时 radix 还焦点,均会干扰
- **PM 的 code mark 吞外层 mark**(DOMParser 行为):`<strong><code>` / `<font><code>` 解析后 code 文本只带 code,外层格式全丢,序列化时 font 被拆开。方言边界:行内代码内无格式,`font-color.test.ts` 锁定降级形态
- **headless 驱动的文本选择不可靠**:加粗/设色后段落换行变化,boundingbox 中心三击会点进行间隙(选中 `\n`);双击坐标随上方异步内容漂移。验证行内命令用键盘(Home + Shift+End)或"选区保留期间连续操作"(color11.js 模式),别重选
- 修改任何解析/序列化行为:**必须跑全量 fixtures**(`pnpm test`,当前 41/41)

## 遗留小事项

- `src/EditorSpike.tsx`:已不被引用,待确认后删除
- 打包版右键菜单中文:dev 模式是裸二进制只有英文(正常);用 `pnpm tauri build` 后开 bundle 里的 砚知.app 验证
- 主 bundle 1MB+:语言分包已做,后续可再做入口级 code-split(不阻塞)
