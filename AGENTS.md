# AGENTS.md

This file provides guidance to Codex (claude.ai/code) when working with code in this repository.

## 项目

砚知(Yanzhi Notes):Tauri 2 桌面端本地离线知识库编辑器,仅 Windows/macOS。**产品事实源是 `docs/PRD-本地离线知识库编辑器.md`**,功能范围、方言规范(§10)、禁止清单(§11)、视觉规范(§12)以 PRD 为准,冲突时先停下来问。**开工前先读 `docs/STATUS.md`**(当前进度、待办、踩坑清单),每阶段收尾时更新它。文档索引见 `docs/README.md`。

## 常用命令

```bash
pnpm tauri dev      # 开发模式(首次 Rust 编译拉 ~400 crate,较慢)
pnpm tauri build    # 打包
pnpm dev            # 仅前端(Vite,端口 1420)
pnpm build          # tsc + vite build,类型检查以此为准
pnpm test           # vitest 全量
pnpm vitest run src/editor/markdown/__tests__/roundtrip.test.ts   # 单文件
pnpm vitest run -t "lists"                                         # 按名过滤
```

测试跑在 jsdom(prosemirror DOMParser 需要 DOM),配置在 `vitest.config.ts`。

## 技术栈锁定(PRD §12,勿擅自升级/替换)

- React 18(不升 19)、TypeScript、Vite、Tauri 2
- 编辑器 Tiptap/ProseMirror;md 解析 markdown-it(**不换 remark**)
- Tailwind v4 + shadcn/ui(radix 底座);图标 lucide-react;不引入 framer-motion
- React 侧不写死色值:唯一色源是 `src/index.css` 的 design tokens(语雀系蓝 + 偏暖灰阶,`:root`/`.dark` 双值),组件一律用 CSS 变量

## 编辑器架构(核心不变量)

**统一 Schema,单一序列化路径** —— 这是编辑器架构(PRD §4)的根基:

- `src/editor/extensions.ts`:唯一扩展集合(含 wikiLink mark、RawHtml、表格对齐、行内图片)。两种模式不存在专有节点类型
- `src/editor/markdown/`:md → HTML(markdown-it + 方言规则:`==高亮==`、`[[双链]]`、任务列表改造)→ PM doc(DOMParser);`serialize.ts` 是 **PM doc → md 的唯一出口**,规范化策略(块间空行/行尾空白/末尾单换行)写在其头注
- `src/editor/markdown/__tests__/fixtures/`:往返 fixtures(md → PM → md 逐字对拍 + 二次稳定)。**任何解析/序列化行为的修改都必须跑全量 fixtures,新边界用例加新 fixture**,不是靠手测

## 存储/网络约束(PRD 红线,摘要)

- 本地优先默认离线:未开 AI 时不得有业务网络请求;AI 仅 BYOK,见 PRD §7.8(AI-0 管道 + AI-1 写作首期)
- 文档 = 标准 Markdown + assets 相对路径(禁 base64);元数据只进 `.yanzhi/`
- 不做:协同、云同步、分享发布、单元格合并、Linux/Electron

## 环境备注

- Rust 走镜像(`src-tauri/.cargo/config.toml`);npm 网络慢,安装超时重试即可
- `pnpm tauri dev` 常驻后台;改 Rust 代码需重启 dev,前端改动走 HMR
