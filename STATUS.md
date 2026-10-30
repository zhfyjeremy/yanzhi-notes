# 项目状态(更新:2026-10-30)

> 开工前速览:看「下一步」直接干活;细节翻 PRD 对应章节。

## 现状一句话

**M2 已提交(11134d1);M3 全部子项代码完成(工作区未提交)**:知识库基座、双链、查找替换、全局搜索、assets 落盘、外部监听、回收站、拖拽排序(含拖入文件夹移动)、导入导出、反向链接面板、未识别条目认领、**设置页(主题三选一)**。**PRD 第 5 章 MVP 功能项已全部覆盖,剩 M4 打磨稳定化**。mock 链路 E2E 全通(`m3.js`/`m3b.js`/`orphan.js`/`drag.js`/`dragimg.js`/`settings.js`/`settings2.js` 等),测试 124/124,tsc/vite/cargo check 过。**剩真实 Tauri 链路手测**(dev 常驻,Rust 命令已注册,含 `move_entry`/`get_settings`/`set_settings`)。

## 里程碑(PRD §11.4 工期表)

### M1 编辑器内核 ✅ 已完成(d19d44e)

统一 Schema、YanzhiEditor 组件(md 进/md 出单路径)、格式工具栏、斜杠菜单、md 往返 fixtures 14/14。
基础轮子:阶段 0 往返管线(e828162)、块编辑模式移除(PRD v1.5,9eb6d7d)、macOS 右键菜单汉化(Info.plist)。

### M2 卡片与面板 ✅ 已完成(11134d1)

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| TOC 大纲面板 | ✅ | 滚动高亮联动、点击跳转、可折叠 |
| 代码块卡片 | ✅ | hover 语言切换/复制、行号列;`src/editor/extensions/code-block-card.tsx` |
| Shiki 语法高亮 | ✅ | `src/editor/extensions/code-highlight.ts`,PM decoration + css-variables 语义槽位 → `--code-*` token |
| 表格编辑工具条 | ✅ | 光标入表浮现:行/列增删下拉 + 整列对齐 + 删表;`table-utils.ts` + `toolbar/TableToolbar.tsx` + 表格基础样式 |
| 粘贴清洗 | ✅ | `paste-clean.ts`(transformPastedHTML):样式/脚本/私有 XML 丢弃、追踪参数剥离、合并表格降级纯文本、外部任务列表转 taskItem、外部颜色吸附预设色 |
| 图片卡片 UI | ✅ | 选中图片浮层(宽度/对齐/放大 lightbox);width/align 是会话级视图属性不进 md,持久化随 M3 方言确认 |
| 文字颜色(语雀式色卡) | ✅ | §10 方言 `<font color>`:色卡 8 色 + 默认清除(`extensions/font-color.ts` + 工具栏 Palette 下拉);粘贴吸附(黑白灰摘除/彩色吸附最近预设色);序列化公共 mark 外提 |

注:PRD 把「[[双链]]+跳转/前进后退」也列在 M2,但跳转依赖知识库文件系统,**挪到 M3 与目录树一起做**。

### M3 知识库与系统 🔨 进行中

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| fs 命令层(Rust) | ✅ 工作区未提交 | `src-tauri/src/kb.rs`:扫描/读/原子写/新建(重名 ` (n)`)/重命名/移入回收站/meta 读写/最近打开(recent.json 含 lastDoc);tauri-plugin-dialog |
| 后端双实现 | ✅ 工作区未提交 | `src/kb/backend.ts`:tauri(invoke)/ browser(localStorage mock)同构,`pnpm dev` 纯浏览器可开发 UI |
| 首启欢迎页 | ✅ 工作区未提交 | PRD 5.0.1:一句话产品 + 三行说明 + 新建/打开同权重 + 最近打开 + 非空目录「仍要在此创建」确认 |
| 目录树左栏 | ✅ 工作区未提交 | 递归渲染/折叠(内存态)/当前文档高亮;行操作语雀式两级:文件夹 hover 仅一个「+」下拉(新建文档/子文件夹),重命名/移入回收站进**右键菜单**(有内容的文件夹在移入回收站项上带原生 title「含 N 篇文档」);重命名 = 行内编辑(Enter/Esc/onBlur 提交);文件夹改名对当前路径与前进/后退历史做前缀重写;E2E 全通(`folder.js`);拖拽排序待 meta.sortIndex 批次 |
| 文档打开与自动保存 | ✅ 工作区未提交 | openDoc(切换前冲刷)+ 2s 去抖落盘(临时文件+原子替换);状态栏保存状态 + 库路径 |
| 标题 ↔ 文件名 | ✅ 工作区未提交 | 标题输入框(语雀式,正文上方)= 文件名去 .md;改名 debounce 800ms → rename_entry + 树刷新 |
| 字数统计 | ✅ 工作区未提交 | 状态栏:全文常显,有选区显「选区/全文」;中文按字西文按词(`word-count.ts` + 6 用例) |
| icon 悬停提示 | ✅ 工作区未提交 | `src/components/hint.tsx`(radix Tooltip 400ms,替代原生 title 的 1-3s 不可控延迟);icon 类全量接入(工具栏/树/查找条/图片工具条/状态栏/导航按钮/**右键删除项**——文件夹含篇数提示),并注入 aria-label;文本截断类(长路径/长标题)保留原生 title |
| 专注模式 | ✅ 工作区未提交 | ⌘/Ctrl+Shift+F 或状态栏按钮,隐藏左右栏突出正文 |
| 复制为纯文本/HTML | ✅ 工作区未提交 | 工具栏复制下拉;tauri 走 clipboard-manager 插件原生写富文本(writeHtml + 纯文本回退),browser 走 navigator.clipboard;复制 HTML 注入内联样式(`clipboard.ts` inlineStyles:表格边框/代码底色/标题字号等,目标环境无 token 体系用固定浅色值) |
| [[双链]] 跳转 | ✅ 工作区未提交 | `[[` 检索菜单(重名强制路径写法 §517)/手打 `[[x]]` inputrule 即时成链/单击跳转(语雀式)/失效 toast;前进后退:⌘[ ⌘] 或 Alt+←/→ + 标题行按钮;mock E2E 全通(`wiki.js`) |
| 重命名联动更新引用 | ✅ 工作区未提交 | rename 时全库替换 `[[旧名]]`(裸名/路径/别名;文件夹仅 [[…]] 区间内段级替换);Rust `kb.rs` 与 mock `wiki-refs.ts` 同构;改名 toast「已更新 N 处」;当前文档被改写自动重载 |
| 文档内查找/替换 | ✅ 工作区未提交 | ⌘F 浮条即时高亮(不区分大小写)/Enter 步进/⌥⌘F 替换行(当前/全部,可撤销);`find-replace.ts` PM plugin + `toolbar/FindReplaceBar.tsx`;E2E 全通(`find.js`) |
| assets 落盘 | ✅ 工作区未提交 | 粘贴/拖拽/文件选择(斜杠菜单+工具栏)→ 内容哈希 FNV-1a 16hex 命名 → 文档所在 `assets/` → `./assets/x.png` 相对路径;渲染经 assetProtocol(tauri)/dataURL(mock),md 真源不污染;`asset-src.ts` 解析注册表 |
| 全局搜索 | ✅ 工作区未提交 | `search.ts`:FlexSearch 三路索引(标题8/路径4/正文1 加权,位次×权重自算排序),CJK bigram+单字、西文整词;160ms 去抖下拉 + `<mark>` 片段高亮 + ↑↓/Enter;点击打开文档并定位(⌘F 查找条联动);空态「重建索引」+ 树菜单入口;增量更新(保存/新建/改名/删除) |
| 外部监听 | ✅ 工作区未提交 | Rust notify v8 + 400ms 静默窗去抖 → `kb-fs-event`;前端自写抑制窗 1.5s;无 dirty 静默重载,有 dirty 弹窗「保留我的/载入磁盘版本」 |
| 回收站 UI | ✅ 工作区未提交 | `TrashDialog.tsx`:列表(文件夹含篇数)+ 单条恢复/**单条彻底删除/清空**(确认条,destructive 样式);原路径冲突三选一(覆盖/新名称/取消),KbConflictError 跨端同构。**永久删除/清空原为 V3,已提前至 M3**(PRD 5.1.1 同步);回收站永久保留、无自动清理。入口 = 左栏底部文字项(语雀式),头部只留「+」下拉(新建文档/文件夹)与「⋯」 |
| 排序与折叠 | ✅ 工作区未提交 | `meta.ts`:sortIndex 持久化(`.yanzhi/meta.json`,300ms 去抖),HTML5 拖拽排序(before/after 同组改序,into = **移动到文件夹**,文件夹 25/50/25),禁拖自身子树;**跨组 before/after = 移动 + 按落位排序**(orderedPaths 传入 moveEntry 走 `applySiblingOrder`,into 落尾 `moveMetaToTail`);折叠状态持久化。**移动 = Rust `move_entry`**(改父目录、名字不变、同名冲突报错、幂等)+ mock 同构:meta 键/折叠键前缀迁移、路径写法 `[[双链]]` 前缀改写(裸名不动)、当前文档/前进后退历史重写;WKWebView 拖拽需 dragstart `setData` + `dragDropEnabled:false`(踩坑清单) |
| 导入导出 | ✅ 工作区未提交 | 导入 md(文件选择 → `![...](...)` 非 http/data/绝对路径图片迁移进 assets + 引用改写);导出当前文档 md / 离线 HTML(`export-html.ts`:图片转 dataURL + 内联样式,语雀式 780px 页面);mock 走 DOM input/blob 下载同构 |
| 反向链接面板 | ✅ 工作区未提交 | `backlinks.ts`(WikiRefIndex 出链索引,与搜索索引同点位增量维护)+ `BacklinksPanel.tsx`(右栏大纲下方分区);裸名/路径/别名三写法归一按目标聚合(解析与点击跳转同构 `resolveWikiTarget`),同源多引用计 ×N;来源入回收站 → 灰态「已删除」,点击引导去回收站(5.1.1-3);点击正常行 = 打开来源 + 查找条带词定位;Rust 新增 `read_all_trash_docs`;右栏改共享 aside,TOC 折叠从竖条改为分区头 chevron |
| 设置与主题 | ✅ 工作区未提交 | §8 设置基座:Rust `get_settings`/`set_settings`(app_config_dir/settings.json 原文透传,前端管结构,mock = localStorage)+ `src/settings.ts`(parse 逐字段校验回退/resolvedIsDark 三态/applyTheme 挂 `.dark` + colorScheme)+ `useSettings`(matchMedia 实时跟随系统,`update(patch)` 合并落盘);`SettingsDialog.tsx` 四组:编辑器(特殊卡片边框开关)/外观(主题三选一 + 排版只读)/图片(粘贴压缩开关)/搜索(索引时机说明 + 重建索引按钮带 toast);入口 = 左栏底部常驻齿轮(主)+ 树头部「⋯ → 设置…」。**卡片边框**:代码块/表格/图片按 PRD 默认带边框(`--border`),关闭 = 容器挂 `yz-flat-cards` 边框全透明(保占位不跳版);**图片压缩**:canvas 前端 WebP q85(`image-compress.ts`,压缩在哈希命名前——同图同设置只存一份;SVG/GIF/压完更大/环境不支持时回退原图),paste/drag 链路生效;**主色色板 = V3,MVP 不做** |
| 未识别条目认领 | ✅ 工作区未提交 | 5.2.1:`meta.ts` 纯函数(findOrphanMeta/claimMetaKey/discardMetaKey,单测锁定)+ `OrphanMetaDialog.tsx`(逐条「认领合并/丢弃」,认领选择器同名优先,丢弃带确认条);入口 = 左栏底部条件渲染「未识别条目 N」(主色)+ 状态栏轻提示;失联扫描点 = 开库 / 外部监听树刷新后 / 整理动作后(`refreshTree` 同步 treeRef,防 .then 先于重渲染);认领的 sortIndex 即时参与树序。**失效双链**(5.2.1-5):点击 → 弹「链接目标不存在」+「搜索同名文档」→ 预置全局搜索(SearchBox 新增 preset) |

## 工作区未提交变更(M3 全量)

- 新增:`src-tauri/src/kb.rs`(fs 命令层 + 双链联动 + watch + assets + trash + 导入导出 + settings)、`src/kb/`(types/backend/useKb/WelcomePage/DocTree/SearchBox/TrashDialog/SettingsDialog/StatusBar/wiki-refs/search/meta/asset-src/export-html)、`src/settings.ts`、`src/editor/word-count.ts`、`src/editor/find-replace.ts`、`src/editor/clipboard.ts`、`src/editor/wiki-link-command.tsx`、`src/editor/toolbar/FindReplaceBar.tsx`、`src/components/hint.tsx` + 测试(search/meta/settings/asset-src/word-count/find-replace/clipboard)
- 修改:`src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`(+tauri-plugin-dialog/+notify/+`protocol-asset` feature)、`src-tauri/tauri.conf.json`(assetProtocol scope)、`src-tauri/capabilities/default.json`、`src/App.tsx`(三栏/专注模式/导航/toast/双链/搜索定位/assets 解析/外部变更弹窗/回收站/导入导出)、`src/editor/YanzhiEditor.tsx`、`src/editor/extensions/`(wiki-link/image-card)、`src/editor/toolbar/`、`src/editor/slash-command/index.tsx`、`src/components/ui/`(dialog forwardRef 等)、`src/index.css`、`src/editor/editor.css`、PRD、`STATUS.md`
- 验证:mock 链路 E2E 全通(`m3.js`/`m3b.js`/`three.js`/`wiki.js`/`find.js`/`folder.js`/`drag.js`/`settings.js`/`settings2.js`);测试 124/124;`pnpm build`(tsc+vite)过;cargo check 过。真实 Tauri 链路手测待做(见下)

## 决策记录

- **图片 width/align 不入方言(M3 定)**:§10 方言表无宽度语法,不擅自扩;两者是会话级视图属性,重启即回原始尺寸(≤正文宽),持久化与 HTML 导出均不带。PRD §10 未加条目 = 明确不加。
- **左栏入口归置(语雀式,2026-10-30)**:新建收敛为头部单个「+」下拉(文档/文件夹);回收站为低频入口,挪到左栏底部文字项;头部仅「+」「⋯」两个 icon。**lucide 1.x 里 `Trash` 与 `Trash2` 是同一图形**(带桶内两竖线,14px 细线下轮廓碎),无更干净的桶形候选,回收站图标改为 `DocTree.tsx` 自绘 `TrashGlyph`(盖沿+提手+锥形桶身)。

## 下一步开工

1. **真实链路手测**(dev 常驻且 Rust 命令全量已注册,可直接开测;批内新增命令:purge_trash/empty_trash/read_all_trash_docs):
   - 双链:插入/跳转/前进后退/改名联动(裸名+路径+别名+文件夹段级);反向链接面板(聚合/×N/已删除灰态/点击定位)
   - 查找替换:⌘F/⌥⌘F/步进/全部替换/Esc;搜索定位(下拉点击 → 打开文档 + 查找条带词)
   - 文件树:文件夹改名(当前路径重写)/右键菜单/+ 下拉定位/移入回收站 → 回收站恢复(含冲突三选一)/单条彻底删除/清空
   - 未识别条目:Finder 里改名一个排过序的文档/文件夹 → 砚知底部出现「未识别条目」+ 状态栏提示 → 认领合并(树序恢复)/丢弃;点失效的路径写法双链 → 「搜索同名文档」
   - **assets 真实写盘**:粘贴/拖拽/文件选择图片 → `assets/<hash>.webp` 落盘 + assetProtocol 渲染(非 dataURL 即真链路);同图不重拷(**拖拽插入已真机验证 ✅ 2026-10-30**,含 Finder 无 MIME + drop target 不可靠两坑修复)
   - **外部监听**:外部编辑器改当前文档(无 dirty 静默重载 / 有 dirty 弹窗二选一);`.yanzhi/` 内部改动不触发
   - **导入导出**:导入含外链图片的 md(迁移进 assets);导出 md/离线 HTML(图片内嵌)另存对话框
   - 拖拽排序 + 折叠持久化(重开库保持);复制为 HTML 贴微信/邮件
   - **设置与主题**:左栏底部齿轮或 ⋯ → 设置…;切深色即时生效,重启保持;「跟随系统」随系统外观实时切换;卡片边框开关联动(关 → 编辑器卡片边框消失);粘贴图片压缩(真机粘贴截图 → assets 下应出现 .webp;设置真实落盘在 app_config_dir,与 mock 的 localStorage 不同链路)
   - icon tooltip 400ms / ⌘⇧F 专注模式不再弹查找条
2. 手测通过后拆分提交 M3(建议按:基座+树 / 双链 / 查找替换+三小件 / 搜索+assets / 监听+trash+排序 / 导入导出 / 设置+主题)
3. 批次 3 = M4:IME 组合键回归、异常恢复(损坏 md/meta 的兜底)、千文档性能(搜索 <100ms / 启动索引 <5s)、`pnpm tauri build` 双平台安装包 + bundle 右键菜单中文验证
4. V3 前置:BYOK AI(PRD §5.8/§11.4)

## 踩过的坑(新代码前必读)

- **React 18 + shadcn new-CLI 组件**:新 CLI 生成的组件无 forwardRef(React 19 风格),radix `asChild` 的 ref 传递会断,popover/dropdown 定位失效。`button.tsx`/`dropdown-menu.tsx`/`context-menu.tsx`/`popover.tsx`/`dialog.tsx`(DialogOverlay:DialogPortal 内部 Presence/asChild 会克隆直接子元素挂 ref)已手工包;**之后每次 `shadcn add` 都要检查**
- **radix 弹层 trigger 不能依赖 CSS `:hover` 维持尺寸**(树「+」下拉实录:菜单弹出覆盖鼠标坐标 → `:hover` 转移到菜单 → `hidden group-hover:flex` 容器塌缩 → popper anchor rect 变 (0,0) → 菜单定位到屏幕左上角)。hover 显隐一律用 `opacity-0 group-hover:opacity-100`(+ `pointer-events-none group-hover:pointer-events-auto` 防透明误点),元素永远保有尺寸
- **radix 统一包(radix-ui ^1.8)的 Tooltip 强制要求 Provider**(独立包时代 Root 可裸用,统一包裸用直接抛 "Tooltip must be used within TooltipProvider" 白屏);且 **Tooltip 必须包在 DropdownMenu/Popover Trigger 的外层**——放内层会挡掉 asChild 注入的 pointerdown 处理器,菜单打不开。`Hint` 组件(`src/components/hint.tsx`)已封装:Provider + forwardRef(合并外部 ref 到 children)+ aria-label 注入(可传 null 关闭),新 icon 提示一律用它。**shadcn 包装层 Trigger 全系已补 forwardRef**(button/dropdown-menu/context-menu/popover);另注意:Hint(TooltipTrigger)asChild 会把自己的 `data-slot` 合并进 child(如右键删除项的 data-slot 变 tooltip-trigger),E2E/样式选择器用 `role="menuitem"` 这类稳定属性
- **shadcn new-CLI 组件的动画类错配 data 变体**(全系实录):`data-open:animate-in` 匹配的是布尔属性 `[data-open]`,radix 实际用 `data-state="open"/"closed"/"delayed-open"/"instant-open"`——**右键菜单/popover/dialog/tooltip 的进出场动画从来没生效过**;且 tooltip 模板漏了 `instant-open`(skipDelay 300ms 内二次触发,如菜单项间移动)状态。已全量改为 `data-[state=open]:` 形态 + 补 instant-open 三件套(tooltip/dropdown/context/popover/dialog 五个文件)
- **flex 滚动**:任何 `flex-1` 滚动容器必须配 `min-h-0`,否则内容把 body 顶出滚动条;整页已设 `body overflow:hidden`,编辑列用 `min-h-0 flex-1`
- **装新依赖后必须重启 dev**:Vite optimizeDeps 在启动时定型,不重启会 resolve 失败(报错像没装一样)
- **Shiki**:必须传 theme(css-variables 占位主题)token 才会细分,否则整行一个 token;`@shikijs/langs`/`@shikijs/engine-javascript` 是直接依赖(pnpm 严格解析),新语言在 `code-highlight.ts` 的 `LANG_IMPORTS` 加字面量 import
- **@tiptap/suggestion 3.32**:`allowedPrefixes: null` 才能任意位置触发;浮层定位的 `fixed` 和 left/top 必须在同一个元素上;**同一 editor 挂第二个 suggestion 必须传独立 `pluginKey`**(默认 `suggestion$` 是模块级单例,重复挂载直接报 keyed plugin 冲突白屏)
- **Tiptap 3.32 InputRule**:handler 返回类型是 `void`(不是 2.x 的 boolean/tr),`undoable` 是必填字段;无效匹配时不改 tr 即可(no-op)
- **PM 位置算术**(table-utils 踩过):`$from.node(depth)` 的父级在 `depth-1` 不是 `depth+1`;`setNodeMarkup(pos)` 要求 `doc.nodeAt(pos)` 命中目标节点——单元格自身位置 = 表格内容起点(tablePos+1)+ 行偏移 + 行开标签 1 + 行内偏移,整体比直觉多 1
- **无浏览器工具时的 UI 验证**:`chromium-cli` 不在时,`/tmp/yanzhi-drive` 里有 playwright-core + 系统 Chrome(`channel:"chrome"`)驱动脚本,`pnpm dev` 起来后 `node drive.js` 可复用
- **updateAttributes 空区间**:collapsed TextSelection 下 `updateAttributes` 按 `[from,to)` 找节点,空区间命不中目标且**不报错**;浮层按钮链路要先 `setNodeSelection(pos)`(ImageToolbar 踩过)
- **jsdom 的 innerHTML 会把 U+00A0 序列化成 `&nbsp;` 实体文本**,文本级 `split("nbsp字符")` 匹配不到,实体和字符两种形态都要处理(paste-clean 踩过)
- **radix 菜单会移动焦点,PM 失焦期间不消费 DOM 选区变化**:菜单类(trigger+item)对行内 mark 的操作不能依赖 `chain().focus()` 恢复选区——`onOpenChange(true)` 时快照 `editor.state.selection`,命令前 `setTextSelection(快照)`;trigger 加 `onMouseDown preventDefault`。菜单打开瞬间焦点在 content 上,关闭时 radix 还焦点,均会干扰
- **PM 的 code mark 吞外层 mark**(DOMParser 行为):`<strong><code>` / `<font><code>` 解析后 code 文本只带 code,外层格式全丢,序列化时 font 被拆开。方言边界:行内代码内无格式,`font-color.test.ts` 锁定降级形态
- **headless 驱动的文本选择不可靠**:加粗/设色后段落换行变化,boundingbox 中心三击会点进行间隙(选中 `\n`);双击坐标随上方异步内容漂移。验证行内命令用键盘(Home + Shift+End)或"选区保留期间连续操作"(color11.js 模式),别重选。另:hover 才显示的容器(`hidden group-hover:flex`)内容不进 `innerText`,断言其内文本用 DOM 存在性(`page.$()`)别用 innerText;`$$eval` 只接受一个附加参数,多参包对象传;**radix DropdownMenu/ContextMenu 的 trigger 靠 pointerdown 打开,`$eval el.click()` 无效**——用真实 `hover()` + `click()` 序列(playwright 会驱动真实 :hover,radix 菜单本身 portal 可见可点,比自绘浮层好测),右键用 `click({ button: 'right' })`
- **同步命令里用 blocking_pick_folder 会死锁**(tauri-plugin-dialog):对话框跑在主线程事件循环,同步命令也在主线程 → 相互等待。必须 `async fn` 命令 + `spawn_blocking`(kb.rs 已是正确写法)
- **Tauri 2 invoke 参数**:JS camelCase ↔ Rust snake_case 自动映射(folderRel → folder_rel),双端命名按各自习惯即可;**但返回值 serde 不映射**——Rust 结构体字段默认 snake_case 序列化,前端读 camelCase 会静默 undefined(TreeNode.is_dir 断裂实录,手测才发现:mock 后端 camelCase 验不出)。跨端结构体要么 `#[serde(rename_all = "camelCase")]` 要么逐字段 rename
- **mock 库首开文档是树序第一篇**(随笔/第一篇,不是开始使用):树序 = 文件夹递归在前。E2E 脚本要先点树切到目标文档再断言,同文档点击会被 openDoc 的 `rel===cur` 守卫拦下(行为正确,脚本易误判)
- **macOS Option 组合快捷键的 `e.key` 是特殊字符**(⌥F → `ƒ`):判断组合键用 `e.code === "KeyF"`,别用 e.key;浮层类组件的 Esc 关闭挂 window 级,不能只挂在 input(焦点在按钮/正文时也要能关);**同修饰键家族的快捷键必须互斥检查**(⌘F 查找没排除 shift → ⌘⇧F 专注模式把查找条也一起打开;两个 handler 都挂 window,preventDefault 不拦其它 listener)
- **WKWebView 的 navigator.clipboard.write 对 text/html 不稳**(手测实录:复制带表格文档贴出只剩拍平文本):富文本/纯文本复制统一走 tauri-plugin-clipboard-manager(`writeHtml(html, 纯文本回退)`,capabilities 加 allow-write-text/allow-write-html);且 getHTML 输出无样式,贴到微信/邮件必须先 `inlineStyles` 注入内联样式(无边框表格观感即"结构丢了")
- 修改任何解析/序列化行为:**必须跑全量 fixtures**(`pnpm test`,当前 124/124)
- **flexsearch 0.7.31 的 d.ts 是错的**(描述 async/worker 形态:`FlexSearch.create`、Promise search、number id),实际 ESM 默认导出 = Index 构造函数、同步 search 返回数组、string id 可用;vitest 走 CJS main 是 `{ Index }` 对象——`search.ts` 头部有运行时探测双兼容。**自定义切词必须挂 `encode`(返回 token 数组)**:挂 `tokenize` 函数静默不生效,CJK 会被默认拉丁编码器整段剥掉(搜索返回空)。多 token 默认 AND,`suggest:true` 兜底 OR
- **内容哈希跨端必须逐字符对齐**:Rust `format!("{hash:016x}")` 是完整 16 hex(`:012x` 是最小宽度不是截断,u64 会打出 16 位,JS 手写截断曾错位);JS BigInt 侧 `toString(16).padStart(16,"0")`。mock 与 Rust 两份实现靠测试向量锁定([0x61] → `af63dc4c8601ec8c`)
- **Tauri assetProtocol**:渲染本地图片需三处齐全——cargo feature `protocol-asset`、tauri.conf.json `security.assetProtocol.enable+scope`、前端 `convertFileSrc`;少 cargo feature 编译直接报 feature not enabled,少 conf 运行时 asset: 请求 403
- **E2E 断言图片别用 `.tiptap img`**:PM 会往编辑器 DOM 塞 `ProseMirror-separator` 无 src 占位 img(mark 间隙 gapfill),必须用内容选择器 `.yz-img-card img`
- **查找条本地输入与插件状态双向同步**:搜索定位等外部路径 `setSearch()` 只写 PM 插件 state,FindReplaceBar 的受控 input 不会自己变(打开是空的);Bar 里用 useEditorState 订阅 `findState.query` 反向 setQuery(自身输入时两者相等不会循环)
- **HTML5 拖拽排序的合成事件测试**:playwright 原生 dragTo 触发不了自绘 before/into/after 分区;在 evaluate 里手工派发 `dragstart/dragover/drop/dragend`(带 `new DataTransfer()`),`clientY` 取目标 rect 比例控制落区,React 合成事件正常响应
- **应用窗口内 HTML5 拖拽不工作的两个叠加根因**:① Tauri 2 `dragDropEnabled` **默认 true**,macOS 上原生 NSView 文件拖放 handler 会吞掉页面内 dragover/drop(浏览器无此层 → 「网页版好使、应用不行」);Rust 侧没人监听 `tauri://drag-drop`,关掉无损失,外部文件拖入反而恢复成 JS drop 事件(编辑器拖图插入依赖它)→ `tauri.conf.json` 窗口配置 `dragDropEnabled: false`。② WebKit 要求 dragstart 里 `dataTransfer.setData` 才真正发起拖拽(Chrome 不要求;注意 conf 改动靠旧 dev watcher 的重编译落地,新起 dev 显示 0.12s Finished 是复用该产物)
- **HMR 给运行中的 App 换自定义 hook 会炸**:给 `useKb` 中途加 useCallback(hook 数量变化)vite 热更新到运行态,报 "change in the order of Hooks" → "Should have a queue. This is likely a bug in React";不是代码 bug,重启 dev/整页刷新即愈,E2E 新开页面不受影响
- **notify 自写抑制**:保存/新建/删除等自身 fs 变更也会触发 watcher,前端统一 `markSelfWrite()`(1.5s 窗口)豁免;Rust 侧过滤 `.yanzhi/` 前缀(meta 写入不触发重载)
- **外部文件拖入 WebView,只在 handleDrop 里 preventDefault 不够**:dragover 没被取消的目标不是合法落点,松手时 WebKit 走默认动作「打开文件」= 整窗导航到那张图,把应用盖掉(真机实录;PM 只管内部节点拖动,不替你取消 dragover)。修法两层:编辑器 `handleDOMEvents.dragover` 对 `Files` 类型取消 + `dropEffect=copy`(App 级 window dragover/drop 兜底——拖到工具栏/侧栏等非落点也不导航)。树排序没踩坑是因为 TreeRow 自己在 onDragOver 里 preventDefault 了。**合成 DragEvent 测试必须带 clientX/clientY**:PM 的 drop 处理先 `posAtCoords`,(0,0) 在编辑区外直接早退,handleDrop 根本不会被调用(树拖拽测不出这个问题,树不用 posAtCoords)
- **useEffect 里 setContent 会触发 React「lifecycle 里 flushSync」警告**:切换文档的 effect 同步派发 setContent → PM 挂载 React NodeView(代码块/图片卡片)→ Tiptap ReactRenderer 内部 flushSync,而此刻 React 还在 commit 阶段。修法(React 官方建议):派发挪进 `queueMicrotask`(加 `editor.isDestroyed` 守卫);事件处理器里的 dispatch 不受影响,只有 effect 里的会踩
- **WKWebView 外部拖拽的两连坑(真机实录)**:① Finder 拖入的 File 常无 MIME type(粘贴板不带 UTI),`type.startsWith("image/")` 会静默滤掉——空 MIME 回退扩展名识别(`isImageFile`);② drop 事件的 **target 不可靠**(文件到了 window 兜底,但不在 `.yz-editor-doc` 上,PM 判「不属于编辑器」直接跳过)——图片落点用滚动区**坐标**判定插入(App 窗口级兜底),PM 自己接住的 drop `stopPropagation` 防双插。诊断手段:`import.meta.env.DEV` 时在 window drop 打日志(types/files/坐标/target),右键 → 检查看 Console

## 遗留小事项

- `src/EditorSpike.tsx`:已不被引用,待确认后删除
- 打包版右键菜单中文:dev 模式是裸二进制只有英文(正常);用 `pnpm tauri build` 后开 bundle 里的 砚知.app 验证
- 主 bundle 1MB+:语言分包已做,后续可再做入口级 code-split(不阻塞)
- V2 候选(开工前 PRD 需先补规范):打字机模式(专注模式子项)、只读源码视图(md 原文对照)
- M3 工作区未提交(全部子项,一个大批次):建议真实链路手测通过后拆分提交
