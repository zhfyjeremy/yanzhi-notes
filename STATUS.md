# 项目状态(更新:2026-10-31)

> 开工前速览:看「下一步」直接干活;细节翻 PRD 对应章节。

## 现状一句话

**MVP(第 5 章)与 M4 大部已提交;V2 批次一(Callout + 公式)与批次二前三项(Mermaid + 历史快照 + 折叠摘要块)已提交并真机验证(2026-10-31)**。当前工作重点 = V2 批次二收尾(附件卡片)+ 真机菜单/设置窗肉眼验证 + M4 尾项(IME 回归、Windows 包)。测试 147/147,`pnpm build` 过。

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
| 设置与主题 | ✅ 工作区未提交 | §8 设置基座:Rust `get_settings`/`set_settings`(app_config_dir/settings.json 原文透传,前端管结构,mock = localStorage)+ `src/settings.ts`(parse 逐字段校验回退/resolvedIsDark 三态/applyTheme 挂 `.dark` + colorScheme)+ `useSettings`(matchMedia 实时跟随系统,`update(patch)` 合并落盘);`SettingsDialog.tsx` 四组:编辑器(特殊卡片边框开关)/外观(主题三选一 + **主色预设色板 6 色** + 排版只读)/图片(粘贴压缩开关)/搜索(索引时机说明 + 重建索引按钮带 toast);**主色色板**(原 V3 项,2026-10-30 提前):运行时内联覆盖 `--primary/--primary-foreground/--ring/--accent/--accent-foreground` 五 token(浅/深两套,每次主题变化重设),自定义色值仍 V3;入口 = 左栏底部常驻齿轮(主)+ 树头部「⋯ → 设置…」。**卡片边框**:代码块/表格/图片按 PRD 默认带边框(`--border`),关闭 = 容器挂 `yz-flat-cards` 边框全透明(保占位不跳版);**图片压缩**:canvas 前端 WebP q85(`image-compress.ts`,压缩在哈希命名前——同图同设置只存一份;SVG/GIF/压完更大/环境不支持时回退原图),paste/drag 链路生效;**主色色板 = V3,MVP 不做** → 已提前至 MVP(预设 6 色,自定义色值仍 V3) |
| 未识别条目认领 | ✅ 工作区未提交 | 5.2.1:`meta.ts` 纯函数(findOrphanMeta/claimMetaKey/discardMetaKey,单测锁定)+ `OrphanMetaDialog.tsx`(逐条「认领合并/丢弃」,认领选择器同名优先,丢弃带确认条);入口 = 左栏底部条件渲染「未识别条目 N」(主色)+ 状态栏轻提示;失联扫描点 = 开库 / 外部监听树刷新后 / 整理动作后(`refreshTree` 同步 treeRef,防 .then 先于重渲染);认领的 sortIndex 即时参与树序。**失效双链**(5.2.1-5):点击 → 弹「链接目标不存在」+「搜索同名文档」→ 预置全局搜索(SearchBox 新增 preset) |

### 设置窗口化 + 关于页(Typora 式,2026-10-30)🔨 代码完成,真机菜单/独立窗待肉眼验

用户需求:设置开独立窗口、左右分类布局、加启动选项、主色长方形带名字、菜单可定制、关于页介绍项目;追加:显示菜单控制右侧面板/工具栏。

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 设置独立窗口 | ✅ 代码完成 | Tauri:`open_aux_window` 命令建/聚焦 label=`settings` 窗口(url `index.html#/settings[?tab=]`,780×560);`main.tsx` 按 hash 分流到 `SettingsWindow`(不挂主 App)。浏览器 dev/E2E 回落 Dialog(`SettingsDialog` 薄壳,同一 `SettingsPage` 组件)。capabilities `windows` 加 `settings` |
| 左右分类布局 | ✅ E2E 过 | `SettingsPage`:左导航(通用/外观/编辑器/图片/搜索/关于,icon+文字)+ 右内容(`settings4.js` ①) |
| 启动选项 | ✅ E2E 过 | 新增 `AppSettings.launch`(last/welcome,默认 last=5.0.4-1 行为);useKb 首启读设置门控自动直开;PRD §8 已同步补【通用设置】 |
| 主色长方形色板 | ✅ E2E 过 | 3 列卡片:色块(h-7 圆角矩形)+ 名称,选中 ring;六色名:语雀蓝(标默认)/紫罗兰/苔绿/青碧/暖橙/绯红(`settings4.js` ③) |
| 菜单全量中文化 | ✅ 代码完成待真机 | 弃用「默认菜单+insert」(会双「文件」),改 `Menu::with_items` 全量重建:砚知(关于/服务/隐藏/退出)、文件(+设置…)、编辑(预定义 undo/cut/…,快捷键 OS 接管)、显示(专注模式+全屏)、窗口(min/max/close)。专注模式**不**加菜单快捷键——⌘⇧F 前端已接管,菜单加速键会双触发 |
| 关于页 | ✅ E2E 过 | 设置「关于」分类:品牌块 + slogan「一方砚,存所知」+ <100 字释义 + 本地优先/开放格式/数据自持三行 + 版本(`src/version.ts` 读 package.json);菜单「关于砚知…」= 设置窗直落 about tab(已开窗时 `yz-settings-tab` 广播切页)。欢迎页副标题加同款 slogan |
| 设置跨窗同步 | ✅ | 设置窗自持 useSettings(读写同一 settings.json),改动 `yz-settings` 广播 → 主窗即时应用(收端 parse 后比对防环);「重建索引」动主窗状态,经 `yz-settings-action` 事件回主窗执行 |
| 显示菜单勾选项 | ✅ E2E 过(布局态) | 右侧面板(大纲+反链)/ 工具栏/专注模式为 `CheckMenuItem`;状态源在前端(panel/toolbar 持久化进 settings,focus 会话级),Rust `ViewFlags` 只镜像,点击 → `kb-menu{action:"view",key,value}` → 前端应用 → `set_view_state` 回写重建菜单翻勾。⌘F 查找条不受工具栏开关影响(按需浮出)。**专注模式强制收工具栏与标题栏导航按钮**(临时态覆盖 showToolbar 偏好,与收左右栏同一语义;标题输入保留 = 文档身份/改名入口,⌘[ ⌘] 仍可用;E2E `settings4.js` ⑧)。E2E:`showToolbar/showRightPanel=false` 预置 → 重启格式条与右栏隐藏、目录树不受影响(`settings4.js` ⑥) |
| 帮助菜单 + 快捷键窗 | ✅ E2E 过(页面体) | 帮助 → 快捷键说明…(macOS 仅此项;Windows 另补关于砚知…,id `yz_about_help` 避免与 App 菜单 `yz_about` 撞 id)。`open_aux_window` 泛化 label(settings/shortcuts),快捷键窗 460×600 不可缩放,hash 路由 `#/shortcuts`(`src/ShortcutsWindow.tsx`);条目与实现逐一对账(全局=App/YanzhiEditor keydown,格式/块级=Tiptap 3 StarterKit 默认键,查找条=find-replace),改键须同步此表。E2E:路由直开五分组 + 25 个 kbd 键帽(`settings4.js` ⑦;坑:同 page goto 只变 hash 不重载,须新开 page) |
| 起始文档错误快捷键修正 | ✅ | 真机反馈:`STARTER_MD` 写「Ctrl/Cmd+E 切换代码块语言」不实——⌘E 实为行内代码(StarterKit Mod-e),代码块卡片无快捷键、语言只在其顶栏下拉。已改模板文案;**已建知识库的 `开始使用.md` 是用户数据不回写**,旧库那行需手改 |

验证:130/130 单测(+launch/显示项解析)、`settings4.js` 13/13、pnpm build、cargo check 过。**待真机**:菜单栏条目、⌘W/⌘Q、设置独立窗口打开/聚焦/关于直落、设置窗改主色主窗即时变、显示菜单勾选翻勾。

### PRD §5 对账补齐(MVP 收尾,2026-10-30)🔨 代码完成,菜单待真机

逐项对账 PRD 第 5 章后的补齐项(此前 STATUS「MVP 已全覆盖」表述不准确,现已补齐):

| 项 | PRD | 状态 |
| --- | --- | --- |
| 原生菜单「文件 → 新建/打开/最近打开」 | 5.0.4-2 | ✅ 代码完成待真机:Rust `build_app_menu`(默认菜单后插入,`set_recent` 时同步重建,id 带序号回查 recent.json);点击发 `kb-menu` 事件 → App 监听执行,非空/已是库确认走 App 级 Dialog。**菜单无法 E2E,setup 无 panic 只能证构建成功,条目内容需真机肉眼看** |
| 新建选到已含 `.yanzhi` 的目录 | 5.0.2-3 | ✅ Rust 已有检测 → 新增 `KbIsYanzhiError` → 欢迎页确认卡改「打开该知识库」引导(菜单触发走 App Dialog 同款) |
| 选择器默认定位 Documents | 5.0.2-2 | ✅ `pick_folder` best-effort set_directory(失败静默) |
| 欢迎页「了解存储方式」展开示意树 | 5.0.1-4 | ✅ E2E 过(`gaps.js`) |
| 当前文档树行自动滚入可视区 | 5.1 | ✅ `data-path` + `scrollIntoView(nearest)`;E2E 过:视口外开 58 篇 → scrollTop 995 行可见;切回第 1 篇不乱滚(`gaps2.js`) |
| 拖拽 ESC 取消 | 5.1 | ✅ 原生行为(macOS Esc 中断拖拽触发 dragend,已清理 dragPath),无代码改动 |
| TOC 大纲面板 | 5.4-1 | ✅ 核对为已有实现(`src/editor/panel/TocPanel.tsx`),此前审计 grep 截断误报缺失 |
| bug:「仍要在此创建」再撞 NOT_EMPTY | — | ✅ `onForceCreate={kb.createKbAt}` 漏传 force,真 bug(E2E 未覆盖非空路径),已改 `(root) => kb.createKbAt(root, true)` |

## V2 特殊卡片(批次二,2026-10-31)🔨 Mermaid+历史快照+折叠摘要完成,附件未动

| 子项 | PRD | 状态 | 说明 |
| --- | --- | --- | --- |
| Mermaid 图表卡 | 6.1.4/§10 | ✅ | **复用 codeBlock**(```mermaid 围栏即存储,解析/序列化零改动,PM 原生编辑 IME/撤销免费;比 mathBlock 式 atom 少一套 md-it 规则);NodeView 特判 language=mermaid:预览态(默认,SVG 渲染,contentDOM display:none 留在 DOM)/源码态(行号+可编辑)双视图,源码态下方 **live 实时预览**(200ms 防抖);单击选中整卡、双击进源码;空卡占位。渲染运行时 `extensions/mermaid.ts`:动态 import 懒加载(mermaid 12.2,主 bundle 未污染,cytoscape/elk/mermaid.core 独立 chunk)、**串行队列**(内部全局单例并发互踩)、主题跟随(浅 neutral/深 dark,initialize 可重复调,MutationObserver 监 html class 切深色即时重渲)、securityLevel strict;语法错误显示错误态不崩。斜杠菜单「Mermaid 图表」(Workflow icon)插默认流程图模板;语言下拉加 mermaid 项。fixture `mermaid.md` 往返+二稳;E2E `mermaid.js` 14/14(含全程无外部请求断言,离线 ✅)。导出 HTML 中与公式同口径 = 源码形态(均不渲染,PRD 5.6 未要求)。真机(2026-10-31)渲染/深色/错误态已验 |
| 文档历史快照 | 6.2/§8 | ✅ | **索引即文件名**:`.yanzhi/history/<rel 去 .md>/<unix_ms>-[a\|m]-<fnv16>.md`(a=自动/m=手动,哈希与 save_asset 同式),无独立索引文件 → 列表与磁盘零漂移;同库同 name 的文档/文件夹并存走 merge-move(id 含时间+哈希无覆盖)。**节流在前端**(settings 有 snapshotIntervalMin/snapshotKeep,内存态最新快照):间隔不足或与最近一份内容相同则跳过,挂在 flushSave 成功后;手动「打快照」不受限。**存储在后端**:Rust `list_history/read_history/save_snapshot`(写后按 keep 清最旧,`read_history` 的 id 先过格式校验防路径逃逸)+ `move_history_dir/remove_history_dir` 挂进 rename/move/恢复/彻底删除/清空;mock 同构(Record<rel, Record<id, 内容>>)。面板 = 右栏第三分区(时间倒序,时间+N 字+自动/手动 badge),对话框 = 只读查看/对比当前(自写行级 LCS diff,`diff.ts` 前后缀裁剪+DP,100 万单元格兜底)+「恢复此版本」(恢复前先为当前内容自动存一份)。顺带修真 bug:**getMarkdownNow 在自动保存落盘后返回陈旧内容**(markdown state 停在 openDoc 版本,导出/复制同中招)——flushSave 不能 setMarkdown(markdown prop 变化会整体重载编辑器丢光标),新增 `savedMdRef` 全落点同步兜底。单测 cargo 4/4 + vitest 144/144;E2E `history.js` 11/11(interval=0 全链路:空态/手动/自动/keep 清理/对比高亮/恢复/改名跟随/重载)。真机(2026-10-31)打快照/恢复已验。**已知缺口:调小 keep 不回溯清理,要等下一次快照写入才裁剪** |
| 折叠摘要块 | 6.1.2/§10 | ✅ | 专用 `details` 节点(同 callout 模式):md-it core 规则 `yz_details` 把 `<details><summary>` 的 html_block retag 为 open/close 对(仅认空属性/open;其它属性/未闭合/引用内一律不转,保持 rawHtml 原文,§4.6)。**open = 持久化的默认展开/收起**(PRD「可设置默认展开/收起」),点 chevron 直接写 attr;summary 纯文本属性(实体解码后存 attr,渲染器自动转义)。NodeView:头部 contentEditable=false(chevron + 非受控 input,IME 安全,Enter=展开并退出);折叠时 contentDOM 仅 display:none 不卸载。renderHTML 输出原生 `<details><summary>`(内容洞包 div)→ 导出 HTML/复制即 GitHub 可折叠形态。粘贴归一化:`normalizeDetails` 原生 details → div[data-details](白名单豁免防 unwrap)。斜杠菜单「折叠块」。fixture `details.md` 7 形态(特殊字符/空内容/嵌套内层 rawHtml/未知属性/引用内/未闭合);E2E `details.js` 11/11(插入/摘要编辑/折叠展开落盘/重载还原/粘贴归一化)。真机(2026-10-31)折叠/展开持久化与粘贴已验 |

## V2 特殊卡片(批次一,2026-10-30)🔨 Callout+公式完成,待提交

| 子项 | PRD | 状态 | 说明 |
| --- | --- | --- | --- |
| Callout 提示块 | 6.1.1/§10 | ✅ | `> [!INFO] 标题` 方言(md-it core 规则 retag,仅 INFO/SUCCESS/WARNING/CAUTION 四类,未知类型保持普通引用)+ `extensions/callout.tsx`(NodeView:标题 input(IME 安全 uncontrolled)+ hover 类型切换下拉);序列化标记行**必须写在 `> ` 前缀内**(push prefixStack 再 write);token `--callout-{type}(-bg)` 浅深两套;斜杠菜单 4 项;fixture `callout.md` 10 形态;E2E `callout.js` 7/7 |
| 行内公式 `$…$` | 6.1.3/§10 | ✅ | md-it inline 规则(before escape,`$$` 让块级):`$` 紧贴非空白才触发、不跨行;latex 走 `encodeURIComponent` 进 `data-latex` 属性(避免 HTML 转义歧义);`mathInline` atom inline 节点 + KaTeX renderToString NodeView,双击进源码编辑;input rule `$E=mc^2$ ` 打完即转 |
| 独立公式块 `$$…$$` | 6.1.3/§10 | ✅ | md-it core 规则:整段 `$$…$$` retag 为 div;**latex 从 inline token 原始 content 提取而非 children**(`\frac` 等反斜杠命令会被 CommonMark 转义规则吃掉);序列化统一 `$$/latex/$$` 三行(单行 `$$E$$` 归一化);`mathBlock` atom block 节点 + hover 编辑按钮;空行打 `$$` input rule 即转卡片;斜杠菜单「公式/行内公式」;fixture `math.md`(多行/引用内/紧贴边界/金额不触发);E2E `math.js` 9/9 + `math-font.js`(KaTeX 字体全同源加载,无外部请求) |
| 插入即编辑的焦点 race | — | ✅ 已绕开 | 空 latex 自动进编辑态的设计与插入命令的 `chain().focus()` 抢焦点(时序不稳,E2E/probe 两行为);改为占位「空公式」+ 双击/hover 按钮进入,交互少一步 magic 但稳定 |
| 斜杠菜单可点击 | — | ✅ 顺带修 | 菜单项原本只支持键盘 Enter(鼠标点击无响应);且 COMMANDS 数组序与分组渲染序不一致时 Enter 会执行错误命令(callout 插入到数组头后暴露)。修法:`flattenSlashItems()` 统一键盘/点击/渲染三方口径,点击直接传 item 对象 |

验证:134/134 单测(新增 callout/math fixtures)、`pnpm build` 过、`callout.js` 7/7、`math.js` 9/9、`callout-style.js`(4 类型浅/深色各自区分)、`math-font.js`(离线字体)。E2E 脚本均在 `/tmp/yanzhi-drive/`。

## M4 打磨稳定化 🔨 进行中

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| 异常恢复 | ✅ 工作区未提交 | 验收 4:read_doc/read_all_docs 非法 UTF-8 → lossy 呈现能打开能存(cargo test `read_doc_lossy_on_invalid_utf8`);meta `parseMeta` 字段异型(数组/数字/字符串)回空对象;mock `setLastDoc` 对损坏 recent.json 容错(原裸 parse 会炸打开链路);loadDoc 失败 → `docError` 状态 → App toast「无法打开」,openDoc/navBack/navForward 失败不动历史栈;已有底子:原子写 + `.tmp` 不入索引、meta/recent/settings 文件级容错、重建索引入口 |
| 千文档性能 | ✅(mock 链 + 真机) | 验收 3 全过(mock 链,1000 篇=950 扁平+5 组×10):索引构建 5ms(<5000)/ 搜索端到端(去抖后含渲染)8ms(<100)/ 树滚动最大帧间隔 28ms(<50);真机实测 1000 篇目录用户确认无问题。`search.bench.test.ts` 回归断言(千篇 build <5s、三类查询中位 <100ms,实测 build ~30ms、查询 ~1ms)。E2E:`/tmp/yanzhi-drive/perf1k.js`(注意:勿预置 recent,否则自动开库欢迎页不出现;搜索计时用 insertText+MutationObserver,勿逐字 type) |
| IME 回归 | ⬜ | Windows/macOS 中文长文输入无异常 + 跨段连续划选(验收 2,真机为主) |
| 安装包 | ✅ macOS(dmg);Windows 缺环境 | `pnpm tauri build` 55s 出包:`砚知.app`(5.34MB)/ `砚知_0.1.0_aarch64.dmg`(2.78MB),dmg 安装、右键菜单中文(拷贝/粘贴/全选)、开库/编辑/自动保存/搜索/拖图冒烟全过(2026-10-30 真机);未签名/公证(本机可用,分发需后续补)。Windows 包需 Windows 环境 |

## 提交记录(近期)

- M3 全量(fs 命令层/树/双链/搜索/assets/监听/回收站/排序/导入导出/设置)随 kb 系列提交;设置窗口化+关于页+菜单全量中文化 = a905c86
- V2 批次二前三项:Mermaid 图表卡(依赖 mermaid 运行时)、文档历史快照(Rust 命令 + 面板/对话框 + diff)、折叠摘要块(details 节点 + md-it retag + 粘贴归一化)各一提交;演示文档「V2 卡片演示.md」在用户库 Desktop/zhishi 中,真实链路打开+自动保存闭环已验(半角括号会被规范化转义为 `\(`,既有 escapeText 行为)

## 决策记录

- **图片 width/align 不入方言(M3 定)**:§10 方言表无宽度语法,不擅自扩;两者是会话级视图属性,重启即回原始尺寸(≤正文宽),持久化与 HTML 导出均不带。PRD §10 未加条目 = 明确不加。
- **左栏入口归置(语雀式,2026-10-30)**:新建收敛为头部单个「+」下拉(文档/文件夹);回收站为低频入口,挪到左栏底部文字项;头部仅「+」「⋯」两个 icon。**lucide 1.x 里 `Trash` 与 `Trash2` 是同一图形**(带桶内两竖线,14px 细线下轮廓碎),无更干净的桶形候选,回收站图标改为 `DocTree.tsx` 自绘 `TrashGlyph`(盖沿+提手+锥形桶身)。

## 下一步开工

1. **V2 批次二(剩)**:附件卡片(6.1.5);之后 6.3/6.4(反链片段/标签/置顶/PDF 导出/窗口大小记忆)
2. **真机肉眼验证(a905c86 批)**:菜单栏条目、⌘W/⌘Q、设置独立窗口打开/聚焦/关于直落、设置窗改主色主窗即时变、显示菜单勾选翻勾;**V2 批次一真机**:演示文档「V2 卡片演示.md」的 callout 类型切换/公式双击编辑(库 = Desktop/zhishi)
3. **真实链路手测**(dev 常驻且 Rust 命令全量已注册;未验子项):
   - 双链:插入/跳转/前进后退/改名联动(裸名+路径+别名+文件夹段级);反向链接面板(聚合/×N/已删除灰态/点击定位)
   - 查找替换:⌘F/⌥⌘F/步进/全部替换/Esc;搜索定位(下拉点击 → 打开文档 + 查找条带词)
   - 文件树:文件夹改名(当前路径重写)/右键菜单/+ 下拉定位/移入回收站 → 回收站恢复(含冲突三选一)/单条彻底删除/清空
   - 未识别条目:Finder 里改名一个排过序的文档/文件夹 → 砚知底部出现「未识别条目」+ 状态栏提示 → 认领合并(树序恢复)/丢弃;点失效的路径写法双链 → 「搜索同名文档」
   - **assets 真实写盘**:粘贴/文件选择图片 → `assets/<hash>.webp` 落盘 + assetProtocol 渲染(**拖拽插入已真机验证 ✅ 2026-10-30**,含 Finder 无 MIME + drop target 不可靠两坑修复)
   - **外部监听**:外部编辑器改当前文档(无 dirty 静默重载 / 有 dirty 弹窗二选一);`.yanzhi/` 内部改动不触发
   - **导入导出**:导入含外链图片的 md(迁移进 assets);导出 md/离线 HTML(图片内嵌)另存对话框
   - 拖拽排序 + 折叠持久化(重开库保持);复制为 HTML 贴微信/邮件
   - **设置与主题**:切深色即时生效重启保持;「跟随系统」实时切换;卡片边框开关;粘贴图片压缩(真机粘贴截图 → assets 出现 .webp;设置真实落盘在 app_config_dir,与 mock 的 localStorage 不同链路)
4. **M4 尾项**:IME 组合键回归(真机)、Windows 安装包(缺环境)
5. V3 前置:BYOK AI(PRD §5.8/§11.4)

## 踩过的坑(新代码前必读)

- **React 18 + shadcn new-CLI 组件**:新 CLI 生成的组件无 forwardRef(React 19 风格),radix `asChild` 的 ref 传递会断,popover/dropdown 定位失效。`button.tsx`/`dropdown-menu.tsx`/`context-menu.tsx`/`popover.tsx`/`dialog.tsx`(DialogOverlay:DialogPortal 内部 Presence/asChild 会克隆直接子元素挂 ref)已手工包;**之后每次 `shadcn add` 都要检查**
- **radix 弹层 trigger 不能依赖 CSS `:hover` 维持尺寸**(树「+」下拉实录:菜单弹出覆盖鼠标坐标 → `:hover` 转移到菜单 → `hidden group-hover:flex` 容器塌缩 → popper anchor rect 变 (0,0) → 菜单定位到屏幕左上角)。hover 显隐一律用 `opacity-0 group-hover:opacity-100`(+ `pointer-events-none group-hover:pointer-events-auto` 防透明误点),元素永远保有尺寸
- **radix 统一包(radix-ui ^1.8)的 Tooltip 强制要求 Provider**(独立包时代 Root 可裸用,统一包裸用直接抛 "Tooltip must be used within TooltipProvider" 白屏);且 **Tooltip 必须包在 DropdownMenu/Popover Trigger 的外层**——放内层会挡掉 asChild 注入的 pointerdown 处理器,菜单打不开。`Hint` 组件(`src/components/hint.tsx`)已封装:Provider + forwardRef(合并外部 ref 到 children)+ aria-label 注入(可传 null 关闭),新 icon 提示一律用它;注意注入会**覆盖手写 aria-label**(克隆 child 时 label 参数直接挂上),E2E 选择器用 `[aria-label*="…"]` 部分匹配。**shadcn 包装层 Trigger 全系已补 forwardRef**(button/dropdown-menu/context-menu/popover);另注意:Hint(TooltipTrigger)asChild 会把自己的 `data-slot` 合并进 child(如右键删除项的 data-slot 变 tooltip-trigger),E2E/样式选择器用 `role="menuitem"` 这类稳定属性
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
- 修改任何解析/序列化行为:**必须跑全量 fixtures**(`pnpm test`,当前 147/147)
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

- **mermaid SVG 会往 DOM 里塞 `<p>`**(htmlLabels 的节点标签):E2E 断言/点击编辑器段落别用 `.tiptap p`,会命中 SVG 内部 p(实录:点到预览区 → setNodeSelection → 打字把整张卡替换掉);一律用 `.tiptap > p`。且**整个编辑器是单一 contenteditable,`Meta+a` 是浏览器级全选全文档**(不是 codeBlock 内全选),NodeView content 的编辑测试用坐标定位光标(右下=末尾追加,左上+打字=破坏行首)
- **mermaid 12 全局单例并发 render 互踩**,渲染必须串行队列(promise chain);`initialize` 可重复调用,主题切换(浅 neutral/深 dark)重设即可;懒加载 `import("mermaid")` 生效时 cytoscape/elk/mermaid.core 是独立 chunk,别不小心静态 import 进主 bundle
- **「当前文档 md」的正确口径是 `dirtyRef.current ?? savedMdRef.current`,别读 markdown state**(历史快照批实录的既有 bug):自动保存落盘后 dirtyRef 清空,而 markdown state 停在 openDoc 时的版本——导出 md/HTML、复制、快照对比全在拿旧文。不能在 flushSave 里 setMarkdown 补同步:markdown prop 变化会触发 YanzhiEditor 整体重载(丢光标/丢撤销栈)。useKb 里 `savedMdRef` 在全部 8 处内容落点(loadDoc/restore/flushSave/空草稿/重命名/移动)同步;新加「取当前内容」的链路一律走 `getMarkdownNow`
- **md-it token retag 三坑(折叠摘要块实录)**:① 渲染器对 token 属性值**自动 HTML 转义**,`attrSet` 存解码明文即可,先手动 escapeAttr 会双重转义(fixture 对拍抓到 `&amp;amp;`);② 复用 html_block token 当闭标签必须改 `nesting = -1`(原 nesting=0 会被渲染成开标签,整篇嵌套错乱);③ PM renderHTML 的内容洞 `0` **必须是父节点唯一子节点**,`["details", attrs, ["summary",…], 0]` 运行时直接 RangeError 白屏(pageerror 才看到),正文包一层 `["div", {}, 0]`

## 遗留小事项

- `src/EditorSpike.tsx`:已不被引用,待确认后删除
- 打包版右键菜单中文:dev 模式是裸二进制只有英文(正常);用 `pnpm tauri build` 后开 bundle 里的 砚知.app 验证
- 主 bundle 1MB+:语言分包已做,后续可再做入口级 code-split(不阻塞)
- V2 候选(开工前 PRD 需先补规范):打字机模式(专注模式子项)、只读源码视图(md 原文对照)
