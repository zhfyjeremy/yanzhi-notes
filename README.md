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
```

依赖:Node.js ≥ 20、pnpm、Rust stable(`rustup`)。

## 打包

### macOS Universal(app + dmg)

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
TAURI_BUNDLER_DMG_IGNORE_CI=true pnpm tauri build --target universal-apple-darwin --bundles app,dmg
```

产物:

```text
src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
```

### Windows x64(NSIS 安装器 + 免安装 zip)

```bash
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
pwsh scripts/package-windows-portable.ps1
```

产物在 `dist-windows/`：NSIS 安装器，以及 `yanzhi-notes-windows-x64.zip`。zip 解压后直接运行 `yanzhi-notes.exe`，资源布局与安装目录一致：

```text
yanzhi-notes.exe
file-icon.ico
resources/yanzhi-reference.docx
resources/yanzhi-highlight.theme
```

免安装包不注册文件关联，也不安装 WebView2。Windows 10（1803 及以后）和 Windows 11 已自带该运行时。窗口位置与配置仍写在 `%APPDATA%\com.yanzhi.notes`。

> 国内网络:`src-tauri/.cargo/config.toml` 已配置 crates.io 镜像,代理可用时可删除。

产品与工程文档见 [docs/](./docs/)（[PRD](./docs/PRD-本地离线知识库编辑器.md) · [STATUS](./docs/STATUS.md)）。
