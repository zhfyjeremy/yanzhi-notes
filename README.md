# 砚知 · Yanzhi Notes

本地离线知识库编辑器。Tauri 2 桌面端(Windows / macOS),语雀式流畅文档体验,标准 Markdown 存储,AI 为 BYOK 可选增强。

## 技术栈

- Tauri 2(Rust)+ React 18 + TypeScript + Vite
- Tailwind CSS v4 + shadcn/ui(radix 底座)
- 编辑器内核:Tiptap / ProseMirror(单一 Schema)
- md 解析:markdown-it(GFM);检索:FlexSearch(CJK bigram)

## 开发

```bash
pnpm install        # 前端依赖
pnpm tauri dev      # 开发模式(首次 Rust 编译较慢)
pnpm tauri build    # 打包安装程序
```

依赖:Node.js ≥ 20、pnpm、Rust stable(`rustup`)。

> 国内网络:`src-tauri/.cargo/config.toml` 已配置 crates.io 镜像,代理可用时可删除。

产品与工程文档见 [docs/](./docs/)（[PRD](./docs/PRD-本地离线知识库编辑器.md) · [STATUS](./docs/STATUS.md)）。
