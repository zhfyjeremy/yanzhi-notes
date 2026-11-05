# 项目状态(更新:2026-11-05)

> 开工前速览:看「下一步」直接干活;细节翻 `docs/PRD-本地离线知识库编辑器.md` 对应章节。文档索引见 `docs/README.md`。

## 现状一句话

**MVP / V2 / V3 功能已齐(含 BYOK AI-0/1/2 + AI-3 卡片)**;PDF 导出暂缓。2026-11-03:关闭窗口保持后台;单实例托盘;AI 结构 + 卡片(代码解释改写 / Mermaid 生成修正 / 公式)。签名/公证与 IME 真机回归仍待。

## 里程碑(PRD §11.4 工期表)

### M1 编辑器内核 ✅ 已完成(d19d44e)

统一 Schema、YanzhiEditor 组件(md 进/md 出单路径)、格式工具栏、斜杠菜单(含日期/时间 6 种静态纯文本格式,本机时区、不自动更新)、md 往返 fixtures 14/14。
基础轮子:阶段 0 往返管线(e828162)、块编辑模式移除(PRD v1.5,9eb6d7d)、macOS 右键菜单汉化(Info.plist)。
2026-11-01 交互补充:空白文档的正文区域撑满可视编辑列;点击留白可聚焦。2026-11-03:左右白边按点击高度落到最近一行(不滚文末),上方→文首、下方→文末;正文/链接/按钮仍走 ProseMirror 默认。

### M2 卡片与面板 ✅ 已完成(11134d1)

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| TOC 大纲面板 | ✅ | 滚动高亮联动、点击跳转、可折叠 |
| 代码块卡片 | ✅ | hover 语言切换/复制、行号列;`src/editor/extensions/code-block-card.tsx` |
| Shiki 语法高亮 | ✅ | `src/editor/extensions/code-highlight.ts`,PM decoration + css-variables 语义槽位 → `--code-*` token |
| 表格编辑工具条 | ✅ | 光标入表浮现:行/列增删下拉 + 整列对齐 + 删表;`table-utils.ts` + `toolbar/TableToolbar.tsx` + 表格基础样式;**列宽拖拽**(`Table.resizable`,colwidth 会话级,GFM 无列宽语法,重开回均分);**单元格悬停复制**(设置/表工具条复制图标同源 `tableCellCopy`,默认关,`TableCellCopy` 浮层);**单元格右键**(`TableContextMenu`,按点中的行/列插删行列、对齐、删表,长表不用滚回浮条,2026-11-05;同日换 Radix 多级菜单并统一 `context-menu`/`dropdown-menu` 视觉) |
| 粘贴清洗 | ✅ | `paste-clean.ts`(transformPastedHTML):样式/脚本/私有 XML 丢弃、追踪参数剥离、合并表格降级纯文本、外部任务列表转 taskItem、外部颜色吸附预设色 |
| 图片卡片 UI | ✅ | 选中图片浮层(宽度档位/对齐/放大 lightbox)+ **左右手柄拖拽改宽**(20%–100%);width/align 会话级不进 md |
| 文字颜色(语雀式色卡) | ✅ | §10 方言 `<font color>`:色卡 8 色 + 默认清除(`extensions/font-color.ts` + 工具栏 Palette 下拉);粘贴吸附(黑白灰摘除/彩色吸附最近预设色);序列化公共 mark 外提 |

注:PRD 把「[[双链]]+跳转/前进后退」也列在 M2,但跳转依赖知识库文件系统,**挪到 M3 与目录树一起做**。

### M3 知识库与系统 🔨 进行中

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| fs 命令层(Rust) | ✅ | `src-tauri/src/kb.rs`:扫描/读/原子写/新建(重名 ` (n)`)/重命名/移入回收站/meta 读写/最近打开(recent.json 含 lastDoc);tauri-plugin-dialog |
| 后端双实现 | ✅ | `src/kb/backend.ts`:tauri(invoke)/ browser(localStorage mock)同构,`pnpm dev` 纯浏览器可开发 UI |
| 首启欢迎页 | ✅ | PRD 5.0.1:一句话产品 + 三行说明 + 新建/打开同权重 + 最近打开 + 非空目录「仍要在此创建」确认 |
| 目录树左栏 | ✅ | 递归渲染/折叠/当前文档高亮;行操作语雀式两级:文件夹 hover「+」下拉(新建文档/子文件夹),重命名/移入回收站进右键菜单;文档右键可复制双链引用(唯一名裸写/重名路径写法,不兼容字符禁用;整段纯文本双链粘贴会立即解析成 wikiLink,而非等重开文档);重命名 = 行内编辑;文件夹改名重写当前路径与前进/后退历史;拖拽排序见「排序与折叠」;E2E `folder.js` |
| 文档打开与自动保存 | ✅ | openDoc(切换前冲刷)+ 2s 去抖落盘(临时文件+原子替换);状态栏保存状态 + 库路径 |
| 标题 ↔ 文件名 | ✅ | 标题输入框(语雀式,正文上方)= 文件名去 .md;改名 debounce 800ms → rename_entry + 树刷新 |
| 字数统计 | ✅ | 状态栏:全文常显,有选区显「选区/全文」;中文按字西文按词(`word-count.ts` + 6 用例) |
| icon 悬停提示 | ✅ | `src/components/hint.tsx`(radix Tooltip 400ms,替代原生 title 的 1-3s 不可控延迟);icon 类全量接入(工具栏/树/查找条/图片工具条/状态栏/导航按钮/**右键删除项**——文件夹含篇数提示),并注入 aria-label;文本截断类(长路径/长标题)保留原生 title |
| 专注模式 | ✅ | ⌘/Ctrl+Shift+F 或状态栏按钮,隐藏左右栏突出正文;子项打字机滚动(`settings.typewriterMode`,默认关,仅专注态生效) |
| 复制为纯文本/HTML | ✅ | 工具栏复制下拉;tauri 走 clipboard-manager 插件原生写富文本(writeHtml + 纯文本回退),browser 走 navigator.clipboard;复制 HTML 注入内联样式(`clipboard.ts` inlineStyles:表格边框/代码底色/标题字号等,目标环境无 token 体系用固定浅色值) |
| [[双链]] 跳转 | ✅ | `[[` 检索菜单(重名强制路径写法 §517)/手打 `[[x]]` inputrule 即时成链/单击跳转(语雀式)/失效 toast;前进后退:⌘[ ⌘] 或 Alt+←/→ + 标题行按钮;mock E2E 全通(`wiki.js`) |
| 重命名联动更新引用 | ✅ | rename 时全库替换 `[[旧名]]`(裸名/路径/别名;文件夹仅 [[…]] 区间内段级替换);Rust `kb.rs` 与 mock `wiki-refs.ts` 同构;改名 toast「已更新 N 处」;当前文档被改写自动重载 |
| 文档内查找/替换 | ✅ | ⌘F 浮条即时高亮(不区分大小写)/Enter 步进/⌥⌘F 替换行(当前/全部,可撤销);`find-replace.ts` PM plugin + `toolbar/FindReplaceBar.tsx`;E2E 全通(`find.js`) |
| assets 落盘 | ✅ | 粘贴/拖拽/文件选择(斜杠菜单+工具栏)→ 内容哈希 FNV-1a 16hex 命名 → 文档所在 `assets/` → `./assets/x.png` 相对路径;渲染经 assetProtocol(tauri)/dataURL(mock),md 真源不污染;`asset-src.ts` 解析注册表;**移动文档时 Rust/mock 同步复制被引用资源并改写路径(9.3.4)** |
| 全局搜索 | ✅ | `search.ts`:FlexSearch 三路索引(标题8/路径4/正文1 加权,位次×权重自算排序),CJK bigram+单字、西文整词;160ms 去抖下拉 + `<mark>` 片段高亮 + ↑↓/Enter;点击打开文档;正文命中才联动⌘F 定位(标题/路径-only 命中只打开不触发文档内查找);空态「重建索引」+ 树菜单入口;增量更新(保存/新建/改名/删除) |
| 外部监听 | ✅ | Rust notify v8 + 400ms 静默窗去抖 → `kb-fs-event`;前端自写抑制窗 1.5s;无 dirty 静默重载,有 dirty 弹窗「保留我的/载入磁盘版本」 |
| 回收站 UI | ✅ | `TrashDialog.tsx`:列表(文件夹含篇数)+ 单条/批量恢复/**单条彻底删除/清空**(确认条,destructive 样式);批量恢复遇同名冲突默认恢复为新名称,避免静默覆盖;原路径冲突三选一(覆盖/新名称/取消),KbConflictError 跨端同构。回收站永久保留、无自动清理。入口 = 左栏底部文字项 |
| 排序与折叠 | ✅ | `meta.ts`:sortIndex 持久化(`.yanzhi/meta.json`,300ms 去抖),HTML5 拖拽排序(before/after 同组改序,into = **移动到文件夹**,文件夹 25/50/25),禁拖自身子树;**跨组 before/after = 移动 + 按落位排序**(orderedPaths 传入 moveEntry 走 `applySiblingOrder`,into 落尾 `moveMetaToTail`);折叠状态持久化。**移动 = Rust `move_entry`**(改父目录、名字不变、同名冲突报错、幂等)+ mock 同构:meta 键/折叠键前缀迁移、路径写法 `[[双链]]` 前缀改写(裸名不动)、当前文档/前进后退历史重写;WKWebView 拖拽需 dragstart `setData` + `dragDropEnabled:false`(踩坑清单) |
| 导入导出 | ✅ | 导入 md(文件选择 → `![...](...)` 非 http/data/绝对路径图片迁移进 assets + 引用改写);导出当前文档 md / 离线 HTML(`export-html.ts`:图片转 dataURL + 内联样式,语雀式 780px 页面);mock 走 DOM input/blob 下载同构 |
| 反向链接面板 | ✅ | `backlinks.ts`(WikiRefIndex 出链索引,与搜索索引同点位增量维护)+ `BacklinksPanel.tsx`(右栏大纲下方分区);裸名/路径/别名三写法归一按目标聚合(解析与点击跳转同构 `resolveWikiTarget`),同源多引用计 ×N;来源入回收站 → 灰态「已删除」,点击引导去回收站(5.1.1-3);点击正常行 = 打开来源 + 查找条带词定位;Rust 新增 `read_all_trash_docs`;右栏改共享 aside,TOC 折叠从竖条改为分区头 chevron |
| 设置与主题 | ✅ | §8 设置基座:Rust `get_settings`/`set_settings` + `src/settings.ts`/`useSettings`;外观(含界面风格卡片/平铺)/阅读参数/卡片边框/图片压缩/搜索重建/打字机等齐全;入口 = 原生菜单设置(`⌘,`)与设置独立窗(左栏齿轮已移除) |
| 未识别条目认领 | ✅ | 5.2.1:`meta.ts` 纯函数 + `OrphanMetaDialog.tsx`:支持逐条认领/丢弃、多选同名批量认领、批量丢弃;认领选择器同名优先,丢弃带确认;入口 = 左栏底部条件渲染「未识别条目 N」+ 状态栏轻提示;失联扫描点 = 开库 / 外部监听树刷新后 / 整理动作后。失效双链保留「搜索同名文档」引导 |

### 设置窗口化 + 关于页(Typora 式,2026-10-30)✅ 代码完成(菜单/独立窗可按需真机抽检)

用户需求:设置开独立窗口、左右分类布局、加启动选项、主色长方形带名字、菜单可定制、关于页介绍项目;追加:显示菜单控制右侧面板/工具栏。

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 设置独立窗口 | ✅ 代码完成 | Tauri:`open_aux_window` 命令建/聚焦 label=`settings` 窗口(url `index.html#/settings[?tab=]`,780×560);`main.tsx` 按 hash 分流到 `SettingsWindow`(不挂主 App)。浏览器 dev/E2E 回落 Dialog(`SettingsDialog` 薄壳,同一 `SettingsPage` 组件)。capabilities `windows` 加 `settings` |
| 左右分类布局 | ✅ E2E 过 | `SettingsPage`:左导航(通用/外观/编辑器/图片/搜索/关于,icon+文字)+ 右内容(`settings4.js` ①) |
| 启动选项 | ✅ E2E 过 | 新增 `AppSettings.launch`(last/welcome,默认 last=5.0.4-1 行为);useKb 首启读设置门控自动直开;PRD §8 已同步补【通用设置】 |
| 主色长方形色板 | ✅ E2E 过 | 3 列卡片:色块(h-7 圆角矩形)+ 名称,选中 ring;六色名:语雀蓝(标默认)/紫罗兰/苔绿/青碧/暖橙/绯红(`settings4.js` ③) |
| 菜单全量中文化 | ✅ 代码完成,图标待肉眼验 | 弃用「默认菜单+insert」,改 `Menu::with_items` 全量重建:砚知/文件/编辑/显示/窗口/帮助。系统预定义项由 macOS 提供原生快捷键与行为;自定义动作项改用 `IconMenuItem + NativeIcon` 显示左侧原生模板图标。设置紧邻「关于砚知」下方,使用 `NativeIcon::Advanced` 真实齿轮并右侧显示 `⌘,`(`PreferencesGeneral` 实际是开关图,已弃用);可勾选分区保留系统勾选标记 |
| 关于页 | ✅ E2E 过 | 设置「关于」分类:品牌块 + slogan「一方砚,存所知」+ <100 字释义 + 本地优先/开放格式/数据自持三行 + 版本(`src/version.ts` 读 package.json);菜单「关于砚知」= 设置窗直落 about tab(已开窗时 `yz-settings-tab` 广播切页)。欢迎页副标题加同款 slogan |
| 设置跨窗同步 | ✅ | 设置窗自持 useSettings(读写同一 settings.json),改动 `yz-settings` 广播 → 主窗即时应用(收端 parse 后比对防环);「重建索引」动主窗状态,经 `yz-settings-action` 事件回主窗执行 |
| 显示菜单勾选项 | ✅ E2E 过(布局态) | 右侧面板(总开关)/ **四个分区独立勾选(大纲/反向链接/标签/历史版本,2026-10-31 用户需求;总开关关时分区项置灰)**/ 工具栏/专注模式为 `CheckMenuItem`;状态源在前端(panel/toolbar/四分区持久化进 settings,focus 会话级),Rust `ViewFlags` 只镜像,点击 → `kb-menu{action:"view",key,value}` → 前端应用 → `set_view_state` 回写重建菜单翻勾。⌘F 查找条不受工具栏开关影响(按需浮出)。**专注模式强制收工具栏与标题栏导航按钮**(临时态覆盖 showToolbar 偏好,与收左右栏同一语义;标题输入保留 = 文档身份/改名入口,⌘[ ⌘] 仍可用;E2E `settings4.js` ⑧)。四分区全关时右栏显示空态提示「分区均已隐藏」;右栏 aside 加 `aria-label="右侧面板"`(E2E/无障碍标识)。E2E:`showToolbar/showRightPanel=false` 预置 → 重启格式条与右栏隐藏、目录树不受影响(`settings4.js` ⑥);分区开关渲染链路 `panel-sections.js` 4/4 |
| 帮助菜单 + 快捷键窗 | ✅ E2E 过(页面体) | 帮助 → 快捷键说明;`open_aux_window` 通用 label(settings/shortcuts),快捷键窗 460×600 不可缩放,hash 路由 `#/shortcuts`。全局快捷键可直接录制、冲突检测、恢复默认并跨窗同步;格式/块级/查找条保留固定说明并与实现逐项对账。E2E 覆盖录制与主窗实际触发 |
| 起始文档错误快捷键修正 | ✅ | 真机反馈:`STARTER_MD` 写「Ctrl/Cmd+E 切换代码块语言」不实——⌘E 实为行内代码(StarterKit Mod-e),代码块卡片无快捷键、语言只在其顶栏下拉。已改模板文案;**已建知识库的 `开始使用.md` 是用户数据不回写**,旧库那行需手改 |

验证:130/130 单测(+launch/显示项解析)、`settings4.js` 13/13、pnpm build、cargo check 过。**待真机**:菜单栏条目、⌘W/⌘Q、设置独立窗口打开/聚焦/关于直落、设置窗改主色主窗即时变、显示菜单勾选翻勾。

### PRD §5 对账补齐(MVP 收尾,2026-10-30)✅ 代码完成(原生菜单可按需真机抽检)

逐项对账 PRD 第 5 章后的补齐项(此前 STATUS「MVP 已全覆盖」表述不准确,现已补齐):

| 项 | PRD | 状态 |
| --- | --- | --- |
| 原生菜单「文件 → 新建/打开/最近打开」 | 5.0.4-2 | ✅ Rust `build_app_menu` + `kb-menu` → App;非空/已是库确认走 Dialog。菜单无法 E2E,条目可按需真机抽检 |
| 新建选到已含 `.yanzhi` 的目录 | 5.0.2-3 | ✅ Rust 已有检测 → 新增 `KbIsYanzhiError` → 欢迎页确认卡改「打开该知识库」引导(菜单触发走 App Dialog 同款) |
| 选择器默认定位 Documents | 5.0.2-2 | ✅ `pick_folder` best-effort set_directory(失败静默) |
| 欢迎页「了解存储方式」展开示意树 | 5.0.1-4 | ✅ E2E 过(`gaps.js`) |
| 当前文档树行自动滚入可视区 | 5.1 | ✅ `data-path` + `scrollIntoView(nearest)`;E2E 过:视口外开 58 篇 → scrollTop 995 行可见;切回第 1 篇不乱滚(`gaps2.js`) |
| 拖拽 ESC 取消 | 5.1 | ✅ 原生行为(macOS Esc 中断拖拽触发 dragend,已清理 dragPath),无代码改动 |
| TOC 大纲面板 | 5.4-1 | ✅ 核对为已有实现(`src/editor/panel/TocPanel.tsx`),此前审计 grep 截断误报缺失 |
| bug:「仍要在此创建」再撞 NOT_EMPTY | — | ✅ `onForceCreate={kb.createKbAt}` 漏传 force,真 bug(E2E 未覆盖非空路径),已改 `(root) => kb.createKbAt(root, true)` |

## V3 自定义文档模板(2026-10-31)✅ 代码完成,用户真机已验证

| 子项 | PRD | 状态 | 说明 |
| --- | --- | --- | --- |
| 模板存储与命令 | 7.5 | ✅ 代码完成 | 模板 = `.yanzhi/templates/*.md`,文件名即模板名;Rust `list_templates`(目录缺失 = 空列表不报错,只列 .md 去扩展名,名称序)/`read_template`(名字防逃逸,非 UTF-8 lossy 同 read_doc)/`write_template`(目录缺失则建)/`delete_template`(模板非正文,不进回收站)/`open_templates_dir`(不存在则创建 + 系统 open,抽 `spawn_open` 与 open_path 共用);`create_doc` 加 `content` 可选参(缺省仍建空文件)。mock 同构:`MockFs.templates`,并**顺手修 mock createDoc 不同构**(此前误写 `# title`,真机 Rust 一直是空文件,9.2) |
| 新建时选择器 | 7.5 | ✅ 代码完成 | App `handleCreateDoc` 拦截 4 个新建入口:`listTemplates` 空 → 零打扰直建(现状不变);非空 → `TemplatePicker`(语雀式:名称输入(打开即全选)+ listbox「空白文档 + 模板」;Enter/创建/双击确认,Esc 取消;底部「管理模板…」互通);模板读取失败回退空白不挡新建 |
| 应用内模板管理 | 7.5 | ✅ 代码完成 | 设置新增独立「模板」分类(通用不再承载模板):卡片列表显示所属库、数量、摘要与表格/任务/Callout/双链结构标记;支持搜索、新建、编辑、复制、删除(二次确认)、打开文件夹。编辑态 720px、内嵌正式 YanzhiEditor,支持编辑/预览切换、脏状态、`Cmd/Ctrl+S` 保存、保存后留在编辑态、未保存取消/切分类确认;确认「继续编辑/丢弃修改」期间隐藏底部「取消/保存」,避免重复入口与无效点击。空态提供会议纪要/周报/阅读笔记三个本地点击创建骨架;支持「从当前文档保存」(设置窗经事件回主窗读取最新正文,命名冲突自动追加编号)。新建选择器同步改为卡片视觉。已知边界:编辑器 onMarkdownChange 去抖 300ms,极速保存由编辑器 doc 现读兜底 |
| 首行 H1 剥离 | 7.5 | ✅ | `templates.ts templateToContent`:模板首行恰为 `# ` 开头时剥离该行 + 紧邻空行——砚知标题由文件名承担(9.2,空白新建正文无 H1),模板建出的同构;H2 以下骨架原样。索引用真实正文(模板可带 [[双链]],反链/搜索立即生效);`#无空格`/H2 开头/无 H1 均原样(单测 8 用例锁定) |
| 设置入口 | 7.5 | ✅ | 设置 → 模板独立分类;模板属于当前知识库 `.yanzhi/templates/`,页面明确展示库与数量。「打开文件夹」保留给习惯文件系统的用户 |

验证:templates 单测 12/12;模板工作台 E2E 9/9(独立分类、卡片摘要/结构、内容搜索、复制、脏状态与 Cmd+S、预览、内置骨架、从当前文档保存、新建选择器卡片)。追加回归:取消编辑出现确认时底部「取消/保存」为 0,继续编辑后恢复,丢弃修改回列表且不写盘。用户 2026-10-31 真机确认基础模板链路正常。

## V3 文档关系图谱(2026-10-31)✅ 代码完成,用户真机已验证

| 子项 | PRD | 状态 | 说明 |
| --- | --- | --- | --- |
| 图谱窗口 | 7.x | ✅ 代码完成 | aux window 复用 `open_aux_window`(label `graph`,1080×760,hash 路由 `#/graph`,显示菜单「文档图谱」入口);`GraphWindow.tsx` + `main.tsx` lazy 分流(**React.lazy 隔离 d3 进独立 chunk**,主 bundle 零污染);capabilities windows 加 `graph` |
| 力导向布局 | 7.x | ✅ | d3-force + SVG:link(90/0.3)/charge(-260)/collide(nodeR+8)/x/y 定心(**不用 forceCenter**,与 x/y 叠加会把图压紧);**alphaDecay 0.05 加速收敛**——默认 ~300 tick(≈5s)才触发 "end",自动 fitView 等不起(首版实录:截图窗口内 end 未触发、canvas 无 transform,图偏挤偏右被观感审计抓到);度数 = 出+入(同源同目标去重),nodeR = 5+√degree×2.4 |
| 数据链 | 7.x | ✅ | getRecent(root/lastDoc)→ readAllDocs 全文 → parseWikiOut 出链 → resolveWikiTarget 归一(与编辑器点击跳转同一解析);失效目标不画边、自链跳过;current = lastDoc 打开时快照(高亮外环 + 标签加粗) |
| 交互 | 7.x | ✅ | 拖拽节点(drag,dragMoved 布尔区分拖拽/点击)、滚轮缩放(zoom filter 排除节点上 mousedown 让给 drag)、k<0.7 隐藏标签;fitView 包围盒自适应(`sim.on("end")` + fitted 标志只首次,**d3-dispatch 无 once 选项**)+「适应窗口/重新读取」按钮;StrictMode 双挂载需 canvas 清场防 join 重复 |
| 跨窗打开 | 7.x | ✅ | 点击节点 → tauri `emit("yz-graph-open", rel)` / 浏览器 CustomEvent(E2E 断言);主窗 App.tsx listen → kb.openDoc + `setFocus()` 拉回前台 |

验证:E2E `graph.js` 12/12(渲染/高亮环/点击事件/无链文案/空态/刷新)、d3 独立 chunk、截图观感过;用户 2026-10-31 真机确认图谱窗、节点交互与跨窗打开正常。

## V3 批量操作 / 快捷键 / 主题 / 资源清理(2026-10-31)✅ 本轮完成

| 子项 | PRD | 状态 | 说明 |
| --- | --- | --- | --- |
| 批量文档操作 | 7.2 | ✅ | 默认树行无勾选框;标题栏「进入批量选择」显式切换模式,模式内整行勾选,支持 Shift 连选、`Cmd/Ctrl+A` 全选可见文档、Esc 退出;文档右键批量选择、文件夹右键选择全部文档;顶部紧凑 `⋯` 菜单提供移动、加/减标签、查找替换与前缀/后缀改名。改名有目标预览、空名/重名/重复目标预检;移动和改名沿用双链联动 |
| 回收站批量恢复 | 7.2 | ✅ | 管理型 Dialog(560px):列表只显示最上层可恢复条目,搜索可命中文件夹子项;整行点击/复选框/Shift 范围/`Cmd+A` 统一多选,批量恢复默认 `rename` 冲突策略;单条恢复与彻底删除收进行级 `⋯` 菜单,清空与彻底删除均需确认 |
| 未识别 meta 批量认领 | 7.2 | ✅ | 多选后按「同类型 + 同名」自动匹配未被占用的目标;匹配不到的原样保留;另支持批量丢弃偏好 |
| 快捷键自定义 | 7.3 | ✅ | `src/shortcuts.ts`:跨平台 `Mod/Alt/Shift + KeyboardEvent.code` 存储;专注模式、前进/后退、查找/替换、斜杠菜单均可录制,冲突检测、恢复默认;帮助窗直接编辑并跨窗同步 |
| 有限主题定制 | 7.6 | ✅ | 自定义 `#rrggbb` 主色(按浅/深生成五 token)、系统默认/宋体/楷体、13–22px 字号、1.3–2.2 行高、0.2–1.6em 段间距;设置即时预览,不写 Markdown |
| 移动文档 assets 迁移 | 9.3.4 | ✅ | Rust/mock 同构:移动文档时复制其仍引用的 assets 到目标文件夹并改写相对路径;源资源保留,避免误删其它文档共用资源 |
| 未引用资源清理 | 7 V3 可选项 | ✅ | 设置 → 存储扫描全库 Markdown(含回收站,防恢复后丢图);只列各层 `assets/` 冗余文件,二次确认后删除;Rust 再校验路径必须位于 `assets/` |

验证:vitest **182/182**、cargo **6/6**、`pnpm build` 过;浏览器真实交互 `remaining-v3.js` **19/19**(选择模式默认无勾选/Shift 连选/Cmd+A/Esc、主题参数、快捷键录制/实际触发、批量移动/标签/改名、批量恢复/多选/认领、Toast 层级、assets 迁移与清理)。

## 全主题视觉优化(2026-10-31)✅

- 新增语义化 surface tokens:`workspace / sidebar / editor / raised / hover / selection / border-subtle`;主色预设和自定义主色通过 `selection` 自动混色,不再把 `accent` 同时用于悬停、选中和品牌强调。
- 三栏改为「深墨外壳 + 宣纸编辑面」:左右栏与编辑面有明确色差,浅色和深色主题共用同一语义层级。
- 目录当前项改为轻浮起导航胶囊(raised + 低强度主色描边 + 主色文件图标),去掉偏表格化的左色条;批量选择仍保持轻量选中底,不产生暗红大色块。
- 正文列用 `EDITOR_COLUMN_MAX`(`max-w-3xl xl:max-w-4xl 2xl:max-w-5xl`)随屏放宽;格式工具栏改为 `w-fit` 居中胶囊,不随正文列拉长成空条;窄纸张按外层容器宽分层隐藏低频操作,极端宽度内滚兜底;表格上下文工具条独立为浮层。
- 标签/大纲/反向链接/历史分区统一标题层级、间距和计数样式;状态栏重排为左侧字数/专注、右侧保存状态/路径。
- 设置窗口同步使用新 surface 与 selection token;自定义主题和深浅色切换统一生效。
- 设置窗口左侧导航与主界面目录选中态统一:轻浮起胶囊 + 低强度主色描边 + 主色图标,去掉左色条。
- 左栏底部移除重复设置齿轮(统一走原生应用菜单与 `⌘,`);回收站改为独立工具胶囊,按最上层条目显示中性数量徽标。
- 左栏标签筛选并入搜索框:标签按钮打开带文档数量、标签内搜索和键盘选择的浮层;筛选生效后才显示可关闭 chip,移除原先像静态分区标题的「# 标签」行。
- 右侧当前文档标签移除常驻输入框:仅保留标签行末端的 ghost `+` chip 打开添加浮层,支持全库标签搜索/复用、使用数量、新建、方向键/Enter 和逗号分号批量输入;已有 chip 的筛选与移除操作分离并扩大删除命中区。
- 历史版本右栏改为按「今天/昨天/日期」分组的时间线:自动快照空心点、手动快照主色实心点,显示时间、字数与相对上一版变化;空态改为虚线卡片。历史对话框同步 `hover/raised/editor/border-subtle` token 与更松弛的 diff 行距。
- 回收站弹窗重构为 560px 管理型 Dialog:顶部搜索 + 全选,顶层条目卡片列表,行级 `⋯` 菜单,底部「清空」与「恢复所选」分离;空态与确认态使用同一主题层级。
- 左侧文档树重构为知识库导航:头部改为库身份卡(图标 + 库名 + 知识库标签),文件夹/文档行 differentiated(文件夹 taller + 主色图标座,文档轻图标座),子级增加连续缩进导轨;当前文档保持 raised 胶囊,置顶态改为圆形主色徽标,拖拽 before/after 提示降饱和,空态改虚线卡片。
- 文档标题左侧的后退/前进按钮改为轻量导航胶囊,收在正文列左边界内侧;窄卡片下不再贴住纸张左缘,标题仍与正文列对齐。

验证:浅色、深色、自定义朱红主色三套截图检查通过;现有 WCAG 对比度审计 **ALL PASS**(正文/表格/代码/Callout/公式/附件/左右栏);`pnpm build` 通过;交互回归 `remaining-v3.js` **19/19**(含无设置齿轮、回收站数量胶囊、标签浮层搜索/筛选/chip);回收站管理流专项回归 **8/8**。

## 设置页信息架构与操作优化(2026-11-01)✅

- 左侧导航按「偏好 / 内容 / 软件」分组:通用、外观、编辑器归偏好;模板、存储、图片、搜索归内容;关于单独归软件,减少 8 个平级分类的心智负担。
- 每个设置页增加标题与一句职责说明;非模板内容列从 `384px` 放宽到 `512px`,行内控件不再拥挤。
- 通用页启动选项改为卡片式单选,直接说明“路径失效回欢迎页 / 手动选择知识库”的差异;数据边界区分应用设置与本库数据。
- 外观页主题改为三张卡片(跟随系统/浅色/深色),附使用场景说明;正文排版新增“恢复默认”一键还原。
- 界面风格双套可切换(`uiStyle`:卡片默认 / 平铺):设置外观页带迷你预览;`data-ui-style` 挂 `<html>`,壳层用 `shell-main`/`shell-panel`/`shell-status` 挂点;平铺=贴边线框、无圆角阴影、台面光晕关闭。红框级 chrome 同步切换:`chrome-search`/`chrome-tree-row(-active)`/`chrome-trash`/`chrome-toolbar`/`chrome-nav`/`chrome-float`——平铺下搜索去抬升、选中改左色条、回收站扁平、格式工具栏通栏、前进后退去胶囊、选区/表格/图片浮条改中等圆角薄边。
- 台面背景 6 预设(`desk`:云白默认/暖玉/青雾/冷石/苔灰/墨台);界面风格默认改为平铺。`applyTheme` 写入 `--workspace`/`--sidebar`/`--surface-hover`/`--code-bg`(代码块/行内 code 底色随台面),平铺时侧栏与台面同色。
- 存储页快照上限/间隔改为带单位的步进器,支持一键恢复默认;资源清理文案改为“资源维护”,强调删除不可恢复。
- 编辑器、图片、搜索页统一 section header + hint 层级;搜索页明确“索引只在本机构建,不上传文档内容”。
- 保留模板独立页的宽版布局与未保存切换确认,模板专项回归不受影响。
- 桌面文案省略号规范:命令后的 `…` 仅表示还会打开文件/文件夹选择器、保存对话框或需要继续输入的管理窗口;纯打开窗口、直接执行和仅弹安全确认的动作不加 `…`。2026-11-01 已去掉「关于砚知」「快捷键说明」「文档图谱」「取消」「清理 n 个」「恢复」「彻底删除」等不合理省略号,搜索占位与加载态保留。
  专项回归 3/3:模板取消确认层无重复按钮、资源清理确认按钮、回收站恢复/彻底删除菜单均无省略号。

验证:`pnpm build` 通过、Vitest **182/182**、设置专项 E2E **9/9**(导航分组、启动/主题卡片、排版恢复、快照步进、边框/图片开关、搜索重建入口、关于页)、模板工作台回归 **9/9**。
追加验证:目录树综合交互 **19/19**;文件夹新建/嵌套/右键新建/重命名/删除链路通过;拖拽排序、拖入文件夹、跨组拖回、双链路径改写与重启持久化通过;5 层嵌套无横向溢出。

## 欢迎页与三栏工作台(2026-11-01)✅

- 应用图标定稿为用户提供设计稿的「现状版」:保留原蓝色砚台表达,按蓝色主体实际边界全出血裁切,左右/上下中心边缘无白边,圆角外背景透明;源文件 `src-tauri/icons/icon-source.png`,已生成 macOS `.icns`、Windows `.ico`、桌面 PNG 与 Store 图标,欢迎页品牌区复用 512px 生成图。概念稿与「砚台现状 / 墨黑」对比稿保留在 `docs/icon-concepts/`。
- 欢迎页改为单栏宣纸引导卡:「新建知识库 / 打开知识库 / 打开 Markdown 文件」三个真实动作同等权重;单文件编辑不再藏在次级虚线卡中。
- 存储事实从可点击感卡片降级为分隔线下的纯文本说明(本地文件夹 / 标准 .md / 复制即备份),避免和动作卡混淆;移除右侧「我的知识库」目录结构示意,释放首屏空间。
- 最近打开从纵向路径列表改为横向卡片(最多各 5 个),显示名称与父目录,并分为「知识库 / Markdown 文件」两组。
- 首屏加入 CSS 三段轻动效:品牌图标落定、三个入口卡错峰浮起、最近打开卡片级联入场;`prefers-reduced-motion` 下全部禁用,不引入动画库。
- 最近打开改为独立圆角轻面板:分组标签、数量、紧凑卡片、右侧方向箭头与 hover 反馈;卡片高度统一 64px,多记录时首页内滚动。
- 欢迎页使用固定视口高度作为滚动容器;最近打开、确认卡等内容变多时可纵向滚动,内容少时仍保持垂直居中,不产生横向溢出。
- 主工作台改为墨色 workspace 外壳 + 三张圆角浮起面板:左栏 `sidebar`、中央 `editor` 纸张、右栏 `sidebar`,统一轻边框与低强度阴影;状态栏独立为底部圆角轻面板。
- 欢迎页动效保持轻量、CSS-only;`prefers-reduced-motion` 下禁用,不引入 framer-motion。

验证:`pnpm build` 通过、Vitest **183/183**、综合交互回归 `remaining-v3.js` **19/19**;1200×800 与 1440×900 下三栏等高、左右栏无横向溢出、状态栏可见,专注模式只剩中央纸张且无溢出。2026-11-01 追加 1000×620 + 20 条最近记录(界面各展示 5 条)验证:欢迎页可滚到底/回顶部且无横向溢出;重构后回归确认 3 个主入口、单文件打开/关闭、最近 Markdown 记录与无横向溢出,存储示意不再出现。动效专项验证普通模式 3 个入口 + 10 张最近卡片错峰入场,reduced-motion 下动画名均为 none;最近知识库/Markdown 卡片可正常进入对应工作区。

## 内置使用文档与首启示例(2026-11-01)✅

- 新建知识库的「开始使用.md」升级为可编辑真实示例:本地存储边界、常用行内格式、任务/表格/引用、双链与标签、斜杠插入、图片/附件相对路径、代码块、**可选 AI 助手(BYOK/入口/结果确认)**、底层 Markdown 源码对照与继续探索入口;Rust 真机与 browser mock 同步(**已建库的「开始使用.md」是用户数据不回写**)。
- 帮助菜单「使用文档」:「快速上手」(同 STARTER_MD)与「Markdown 能力示例」(含与 AI 关系一节);820×620 离线帮助窗,排版 / 源码可切换。
- Markdown 能力示例覆盖基础格式、HTML 预设色、标题、任务、四种 Callout、表格、代码、行内/块级公式、多行公式、Mermaid 流程图与时序图、折叠块、图片、附件、双链和兼容边界;帮助窗直接 KaTeX 渲染公式、Mermaid 渲染 SVG,并保留源码对照。
- 帮助窗内容内置在应用内,不发起网络请求;markdown-it 静态渲染补充 Callout/Details/Math/Mermaid 样式,与编辑器 token 层级一致。

验证:浏览器回归通过——帮助窗 `?tab=quick-start` 直开、排版/源码切换、Markdown 示例表格/Callout/代码块渲染正常;能力示例专项验证行内公式 ×3、块级公式 ×2、Mermaid SVG ×2、折叠块交互、预设色、任务与四种 Callout。mock 首启「开始使用.md」展示存储说明、任务、表格与代码块。`pnpm test` **183/183**、`cargo test` **6/6**、`pnpm build` 与 `pnpm tauri build --no-bundle` 通过;知识库综合回归 `remaining-v3.js` **19/19**。原生帮助子菜单需真机肉眼最终确认。

## CI 双端打包(2026-11-01)✅

- 新增 `.github/workflows/desktop-release.yml`:支持 `workflow_dispatch` 手动打包与 `v*` tag 自动发布。
- macOS `macos-14` 构建 `universal-apple-darwin`,产出未签名 Universal `.dmg`。构建时设 `TAURI_BUNDLER_DMG_IGNORE_CI=true`,否则 Actions 的 `CI=true` 会跳过安装盘排版,打开后只能直接运行应用。Windows `windows-latest` 构建 `x86_64-pc-windows-msvc`,`--bundles nsis`,只产出 NSIS `.exe`。
- 双平台并行构建,产物分别上传 Actions artifacts;tag 触发时合并产物并自动创建 GitHub Release。当前未接入代码签名与公证,正式分发仍需补 Apple Developer ID、公证与 Windows 代码签名密钥。
- 2026-11-03 修复 Windows MSI 在 GitHub Actions 的 WiX `LGHT0311`:中文 `productName` 搭配默认 `en-US` 会落到 code page 1252,现设 `bundle.windows.wix.language = zh-CN`;同时将 workflow actions 升级到 Node.js 24 runtime;待重新触发 Actions 验证。

## 单文件轻编辑模式(2026-11-01)✅ P0/P1 代码完成

- 产品口径固化到 `docs/single-file-mode.md`,PRD §2.1/§2.2 已补充:单文件模式直接打开 `.md`/`.markdown`,手动保存回原路径,不创建 `.yanzhi/`、不建索引、不启用标签/反链/历史/回收站/图谱等知识库专属能力。
- P0:欢迎页轻量入口、原生菜单打开/保存/另存为/关闭、独立最近文件列表、单文件中央纸张 UI、路径胶囊、状态栏、手动保存、关闭确认、外部改动弹窗、只读/丢失状态、原子替换写入。
- P1:图片/附件写入前确认创建同目录 `assets/`(当前会话有效);崩溃恢复草稿存应用缓存并在重开时提示;「存入知识库」复制当前文件与引用资源;拖拽 Markdown 打开;系统「打开方式」把砚知列为候选但不抢占默认关联。
- Tauri 新增单文件选择/读写/另存为/目录监听/最近记录/草稿/转存命令;macOS `RunEvent::Opened` 与启动参数进入同一打开通道。
- 欢迎页最近打开分为「知识库 / 单文件」两组;单文件模式保留可选大纲、格式工具栏、查找替换、主题、排版、导出 md/HTML。
- 工作区切换闭环:单文件存入知识库后弹「继续编辑单文件 / 保存并打开知识库」,打开后自动定位新文档;取消选择文件时留在当前知识库。
- 工作区入口归位到左栏顶部库身份卡菜单:「返回欢迎页 / 打开 Markdown 文件 / 打开其它知识库 / 新建知识库」;左栏底部移除工作区按钮,只保留回收站与库内工具,避免混层。
- 2026-11-05:单文件顶栏去掉右上「打开知识库 ▾」;最近库直开 / 浏览其它位置 / 新建并入「单文件 ▾」,路径只读,标题旁仍为大纲/保存/更多。
- 修复工作区切换后的旧 Tiptap 实例泄漏:App 按 `kb / single` 标记 editor 归属,卸载中的实例不再进入右栏大纲/状态栏;`TocPanel` 对 `editor.view` 不可用时直接跳过滚动定位与跳转。

验证:`pnpm test` **183/183**、`cargo test` **6/6**、`pnpm build` 通过、`pnpm tauri build --no-bundle` 通过(fileAssociations 配置有效);知识库综合回归 `remaining-v3.js` **19/19**。浏览器单文件回归覆盖轻量入口、左右栏降级、手动保存、未保存关闭确认、最近文件重开、崩溃草稿恢复、拖拽打开、assets 确认与资源随文档转存知识库;追加验证「存入后保存原文件并打开知识库 → 自动定位新文档 → 回首页 → 从知识库进入单文件」闭环。系统「打开方式」与 macOS Opened 事件需打包版真机最终确认。

## V2 导出与主题(6.4 批次,2026-10-31)✅ 全部完成

| 子项 | PRD | 状态 | 说明 |
| --- | --- | --- | --- |
| 窗口记忆 | 6.4-3 | ✅ 真机已验 | **tauri-plugin-window-state**(Rust 端注册即可,前端零改动,npm 包不装):主窗大小/位置关闭时自动落盘 app_config_dir、启动恢复,多屏/DPI/越界夹回由插件处理。主窗 `visible:false`(2026-11-03):先隐藏、restore 后再 show,避免「默认位置闪一下再跳到记忆位」。`skip_initial_state("settings"/"shortcuts"/…)`——辅助窗不恢复旧状态。库/文档/面板折叠记忆此前已有,本项是最后一块拼图 |
| PDF 导出 | 6.4-1 | ❌ 已撤销 | 两版均下线:①「打印版 HTML + 浏览器打印」(PRD 原主方案)被用户否决——链路太长体验不佳;②改「砚知内直出 .pdf」(屏外 webview + WKWebView printOperation/NSPrintSaveJob)实测**有问题**,用户拍板撤销不做了。功能整体移除(菜单/命令/依赖/打印样式全清,vitest 回 157/157),导出回到 md/离线 HTML 两项。**PRD 6.4-1 已标暂缓;后续重做教训:直出方案的屏外窗口渲染/打印时机在本机表现不稳,先做小样验证再上** |
| 双主题打磨 | 6.4-2 | ✅ 代码完成 | **自动化 WCAG 对比度审计**代替凭感觉调色:E2E 内取 computed fg/bg(向上爬祖先链做半透明 alpha 合成 + opacity 链乘积),正文 4.5:1 / 大字与 UI 3.0:1 双阈值,覆盖 26 项目标(callout×4 标题+正文/表格/引用/代码四类 token/公式/折叠/附件/任务/双链/栏栏)浅深两轮,脚本 `/tmp/yanzhi-drive/audit-contrast.js`。修复(全在 token 层,组件零改动):① 新增 `--link` token(浅 hsl(204 89% 36%)/深 62%)——文内链接与 UI 主色语义分离,主色保持鲜亮用于按钮/选中,正文链接深一档保长文 AA,`editor.css` 链接(含双链)统一引用;② `--muted-foreground` 浅色 46%→44%(引用块顺带达标);③ callout 浅色话语色四色加深到 27-44%(深色侧本来就 5.6+ 不动);④ `--code-cm` 浅 42%/深 58%。结果 26/26 深浅全 PASS(浅色最低 4.71、深色最低 4.76);截图 theme-light/dark.png 观感确认无退化。测试 157/157 + build 过 |

窗口记忆验证:改窗口大小/位置 → ⌘Q 退出 → 重开恢复(2026-10-31 真机过)。

## V2 双链增强(6.3 批次,2026-10-31)✅ 已提交(b983837)并真机验证

| 子项 | PRD | 状态 | 说明 |
| --- | --- | --- | --- |
| 反链引用片段 | 6.3-1 | ✅ 代码完成 | parseWikiOut 逐行扫描 + heading 栈(层级截断)产出章节路径(「安装 / macOS」,文首 null);code fence 门控 heading(fence 内 [[链接]] 仍计数,保持基础版语义)。OutLink 增 `label`(别名优先)/`heading`/`snippet`(引用前后各 24 字带省略号,含 [[…]] 原文)。面板每引用一行(替代原 count 聚合,同源多引用展开):来源名 + heading 右侧小字 + 两行片段,[[…]] 段 primary 高亮;已删除灰态保留 |
| 文档置顶 | 6.3-3 | ✅ 代码完成 | `meta.docs.pinned`(DocMeta 字段早预留)+ sortTree 第一关键字(仅文档,置顶组内仍按 sortIndex/名称;**不越级** = 只作用于所在层级,子层置顶不影响根层);右键「置顶/取消置顶」,置顶行名称旁 Pin 图标;置顶行禁拖、不作 before/after 落点(永远最上,落位无意义);setDocPinned 幂等,false 不留脏键 |
| 文档标签 | 6.3-2 | ✅ 代码完成 | 纯 meta(`tags: string[]` 不进正文,§10 无标签方言);搜索索引把 tags 以 `#tag` 拼进正文尾部参与 content 匹配(raws 片段仍取原文,命中位置不漂移);右栏 TagsPanel(折叠头 + chips:点击 = 左栏按标签过滤树(带标签文档保留,空文件夹隐藏,过滤态全树禁拖)、× = 移除;底部输入框回车批量添加,逗号/分号拆分——**onAdd 批量单调用**,避免连续多次展开同一渲染的 currentTags 互相覆盖的闭包竞态);树搜索框下标签筛选下拉(全库标签);setTags 原位更新搜索索引 |

验证:vitest 157/157(backlinks 重写:heading 栈/fence 门控/片段截断;meta +8 用例:置顶序含组内 sortIndex/不越级/setDocPinned 幂等/setDocTags 去重保序/allTagsOf/filterTreeByTag 空文件夹隐藏)、`pnpm build` 过、E2E `v23.js` 12/12(反链两行展开+章节位置+高亮、置顶右键→最上+重载持久+取消恢复、标签批量添加→chip 过滤树只剩目标→清除恢复→搜索「#tag 词」命中→meta localStorage 持久化)。真机已验(2026-10-31 用户确认「OK 了」,b983837 提交)。截图 `/tmp/yanzhi-drive/v23-final.png`(分析服务当日故障未跑成,观感以 E2E DOM 断言为准)

## V2 特殊卡片(批次二,2026-10-31)✅ 全部完成并真机验证

| 子项 | PRD | 状态 | 说明 |
| --- | --- | --- | --- |
| Mermaid 图表卡 | 6.1.4/§10 | ✅ | **复用 codeBlock**(```mermaid 围栏即存储,解析/序列化零改动,PM 原生编辑 IME/撤销免费;比 mathBlock 式 atom 少一套 md-it 规则);NodeView 特判 language=mermaid:预览态(默认,SVG 渲染,contentDOM display:none 留在 DOM)/源码态(行号+可编辑)双视图,源码态下方 **live 实时预览**(200ms 防抖);单击选中整卡、双击进源码;空卡占位。渲染运行时 `extensions/mermaid.ts`:动态 import 懒加载(mermaid 12.2,主 bundle 未污染,cytoscape/elk/mermaid.core 独立 chunk)、**串行队列**(内部全局单例并发互踩)、主题跟随(浅 neutral/深 dark,initialize 可重复调,MutationObserver 监 html class 切深色即时重渲)、securityLevel strict;语法错误显示错误态不崩。斜杠菜单「Mermaid 图表」(Workflow icon)插默认流程图模板;语言下拉加 mermaid 项。fixture `mermaid.md` 往返+二稳;E2E `mermaid.js` 14/14(含全程无外部请求断言,离线 ✅)。导出 HTML 中与公式同口径 = 源码形态(均不渲染,PRD 5.6 未要求)。真机(2026-10-31)渲染/深色/错误态已验 |
| 文档历史快照 | 6.2/§8 | ✅ | **索引即文件名**:`.yanzhi/history/<rel 去 .md>/<unix_ms>-[a\|m]-<fnv16>.md`(a=自动/m=手动,哈希与 save_asset 同式),无独立索引文件 → 列表与磁盘零漂移;同库同 name 的文档/文件夹并存走 merge-move(id 含时间+哈希无覆盖)。**节流在前端**(settings 有 snapshotIntervalMin/snapshotKeep,内存态最新快照):间隔不足或与最近一份内容相同则跳过,挂在 flushSave 成功后;手动「打快照」不受限。**存储在后端**:Rust `list_history/read_history/save_snapshot`(写后按 keep 清最旧,`read_history` 的 id 先过格式校验防路径逃逸)+ `move_history_dir/remove_history_dir` 挂进 rename/move/恢复/彻底删除/清空;mock 同构(Record<rel, Record<id, 内容>>)。面板 = 右栏第三分区(时间倒序,时间+N 字+自动/手动 badge),对话框 = 只读查看/对比当前(自写行级 LCS diff,`diff.ts` 前后缀裁剪+DP,100 万单元格兜底)+「恢复此版本」(恢复前先为当前内容自动存一份)。顺带修真 bug:**getMarkdownNow 在自动保存落盘后返回陈旧内容**(markdown state 停在 openDoc 版本,导出/复制同中招)——flushSave 不能 setMarkdown(markdown prop 变化会整体重载编辑器丢光标),新增 `savedMdRef` 全落点同步兜底。单测 cargo 4/4 + vitest 144/144;E2E `history.js` 11/11(interval=0 全链路:空态/手动/自动/keep 清理/对比高亮/恢复/改名跟随/重载)。真机(2026-10-31)打快照/恢复已验。**已知缺口:调小 keep 不回溯清理,要等下一次快照写入才裁剪** |
| 折叠摘要块 | 6.1.2/§10 | ✅ | 专用 `details` 节点(同 callout 模式):md-it core 规则 `yz_details` 把 `<details><summary>` 的 html_block retag 为 open/close 对(仅认空属性/open;其它属性/未闭合/引用内一律不转,保持 rawHtml 原文,§4.6)。**open = 持久化的默认展开/收起**(PRD「可设置默认展开/收起」),点 chevron 直接写 attr;summary 纯文本属性(实体解码后存 attr,渲染器自动转义)。NodeView:头部 contentEditable=false(chevron + 非受控 input,IME 安全,Enter=展开并退出);折叠时 contentDOM 仅 display:none 不卸载。renderHTML 输出原生 `<details><summary>`(内容洞包 div)→ 导出 HTML/复制即 GitHub 可折叠形态。粘贴归一化:`normalizeDetails` 原生 details → div[data-details](白名单豁免防 unwrap)。斜杠菜单「折叠块」。fixture `details.md` 7 形态(特殊字符/空内容/嵌套内层 rawHtml/未知属性/引用内/未闭合);E2E `details.js` 11/11(插入/摘要编辑/折叠展开落盘/重载还原/粘贴归一化)。真机(2026-10-31)折叠/展开持久化与粘贴已验 |
| 附件卡片 | 6.1.5 | ✅ | **存储 = 标准链接**(§10 无附件专用方言,卡片是砚知渲染增强):md-it core 规则 `yz_attachment` 把「独立段落恰为 `[名](./assets/x.ext)` 单链接」retag 为 atom 节点,行内混排/非 assets 相对路径/外链/带 title/空名称一律保持普通链接不误伤。斜杠菜单「附件」→ Rust `pick_files` 多选 → `import_asset` 哈希落盘(与图片同式)→ 插卡;点击卡片 `open_path` 唤系统打开(macOS `open`/Windows `start`,复用 resolve canonicalize 防路径逃逸;不存在 → toast「文件不存在或已被移动」);mock 三态 ok/missing/unsupported。**顺手修两既有缺口**:①Link 的 title 静默丢弃——StarterKit 内置 Link 无 title attr,改 `link:false` + `Link.extend` 补 attr + 序列化 `"title"`(新依赖 `@tiptap/extension-link` 3.32.2,StarterKit 内置包 pnpm 严格解析不显式安装不能 import);②md-it 默认 `normalizeLink` 百分号编码非 ASCII 目标(中文路径落盘被改写)→ 覆写恒等。fixture `attachment.md` 9 形态;E2E `attachment.js` 8/8(mock 链路:手写开即卡/混排不转/toast/菜单插入 filechooser 注入/哈希落盘/重载还原/无百分号编码)。真机(2026-10-31)插入/落盘/系统打开已验 |

## V2 特殊卡片(批次一,2026-10-30)✅ Callout+公式已完成

| 子项 | PRD | 状态 | 说明 |
| --- | --- | --- | --- |
| Callout 提示块 | 6.1.1/§10 | ✅ | `> [!INFO] 标题` 方言(md-it core 规则 retag,仅 INFO/SUCCESS/WARNING/CAUTION 四类,未知类型保持普通引用)+ `extensions/callout.tsx`(NodeView:标题 input(IME 安全 uncontrolled)+ hover 类型切换下拉);序列化标记行**必须写在 `> ` 前缀内**(push prefixStack 再 write);token `--callout-{type}(-bg)` 浅深两套;斜杠菜单 4 项;fixture `callout.md` 10 形态;E2E `callout.js` 7/7 |
| 行内公式 `$…$` | 6.1.3/§10 | ✅ | md-it inline 规则(before escape,`$$` 让块级):`$` 紧贴非空白才触发、不跨行;latex 走 `encodeURIComponent` 进 `data-latex` 属性(避免 HTML 转义歧义);`mathInline` atom inline 节点 + KaTeX renderToString NodeView,双击进源码编辑;input rule `$E=mc^2$ ` 打完即转 |
| 独立公式块 `$$…$$` | 6.1.3/§10 | ✅ | md-it core 规则:整段 `$$…$$` retag 为 div;**latex 从 inline token 原始 content 提取而非 children**(`\frac` 等反斜杠命令会被 CommonMark 转义规则吃掉);序列化统一 `$$/latex/$$` 三行(单行 `$$E$$` 归一化);`mathBlock` atom block 节点 + hover 编辑按钮;空行打 `$$` input rule 即转卡片;斜杠菜单「公式/行内公式」;fixture `math.md`(多行/引用内/紧贴边界/金额不触发);E2E `math.js` 9/9 + `math-font.js`(KaTeX 字体全同源加载,无外部请求) |
| 插入即编辑的焦点 race | — | ✅ 已绕开 | 空 latex 自动进编辑态的设计与插入命令的 `chain().focus()` 抢焦点(时序不稳,E2E/probe 两行为);改为占位「空公式」+ 双击/hover 按钮进入,交互少一步 magic 但稳定 |
| 斜杠菜单可点击/二级分组 | — | ✅ 顺带修 | 菜单项原本只支持键盘 Enter(鼠标点击无响应);且 COMMANDS 数组序与分组渲染序不一致时 Enter 会执行错误命令(callout 插入到数组头后暴露)。修法统一键盘/点击/渲染三方口径,点击直接传 item 对象。2026-11-05:菜单视觉对齐 `chrome-float`/`raised`/紧凑 item;无搜索时标题、列表、日期时间、提示块、公式、AI 收进二级菜单,支持左右键/Escape 与 hover;有搜索时仍平铺命中叶子命令,`/h1` 等熟手路径保持一步执行 |

验证:134/134 单测(新增 callout/math fixtures)、`pnpm build` 过、`callout.js` 7/7、`math.js` 9/9、`callout-style.js`(4 类型浅/深色各自区分)、`math-font.js`(离线字体)。E2E 脚本均在 `/tmp/yanzhi-drive/`。

## M4 打磨稳定化 🔨 进行中

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| 异常恢复 | ✅ | 验收 4:read_doc/read_all_docs 非法 UTF-8 → lossy 呈现能打开能存(cargo test `read_doc_lossy_on_invalid_utf8`);meta `parseMeta` 字段异型(数组/数字/字符串)回空对象;mock `setLastDoc` 对损坏 recent.json 容错(原裸 parse 会炸打开链路);loadDoc 失败 → `docError` 状态 → App toast「无法打开」,openDoc/navBack/navForward 失败不动历史栈;已有底子:原子写 + `.tmp` 不入索引、meta/recent/settings 文件级容错、重建索引入口 |
| 千文档性能 | ✅(mock 链 + 真机) | 验收 3 全过(mock 链,1000 篇=950 扁平+5 组×10):索引构建 5ms(<5000)/ 搜索端到端(去抖后含渲染)8ms(<100)/ 树滚动最大帧间隔 28ms(<50);真机实测 1000 篇目录用户确认无问题。`search.bench.test.ts` 回归断言(千篇 build <5s、三类查询中位 <100ms,实测 build ~30ms、查询 ~1ms)。E2E:`/tmp/yanzhi-drive/perf1k.js`(注意:勿预置 recent,否则自动开库欢迎页不出现;搜索计时用 insertText+MutationObserver,勿逐字 type) |
| IME 回归 | ⬜ | Windows/macOS 中文长文输入无异常 + 跨段连续划选(验收 2,真机为主) |
| 安装包 | ✅ macOS(dmg)+Windows(exe/nsis) | macOS:`砚知.app` / dmg 真机冒烟过(2026-10-30);Windows:`dist-windows` 已出包。未签名/公证(本机可用,分发需后续补) |

## 提交记录(近期)

- M3 全量(fs 命令层/树/双链/搜索/assets/监听/回收站/排序/导入导出/设置)随 kb 系列提交;设置窗口化+关于页+菜单全量中文化 = a905c86
- V2 批次二四项各一提交:Mermaid 图表卡(依赖 mermaid 运行时)、文档历史快照(Rust 命令 + 面板/对话框 + diff)、折叠摘要块(details 节点 + md-it retag + 粘贴归一化)、附件卡片(attachment 节点 + Rust pick_files/open_path + Link title/normalizeLink 两缺口修复,含新依赖 @tiptap/extension-link);演示文档「V2 卡片演示.md」在用户库 Desktop/zhishi 中,真实链路打开+自动保存闭环已验(半角括号会被规范化转义为 `\(`,既有 escapeText 行为)

## 决策记录

- **右栏低频分区默认折叠(2026-10-31)**:反向链接与历史版本初始为收起态,点击分区头可展开;仍受菜单「显示」中的独立显隐控制,展开状态维持会话级、不持久化。
- **Toast 必须盖过 Dialog(2026-10-31)**:回收站恢复提示曾被同 `z-50` 的 mask 遮挡;全局 toast 固定 `z-[100]`,并加 `role=status/aria-live`,弹窗内操作反馈保持可见。
- **标签只存 meta 不进正文(6.3 定)**:§10 方言表无 #tag 行内语法,标签写入正文会污染往返与外部编辑;搜索把 tags 以 `#tag` 拼进正文索引只是命中技巧(raws 片段仍取原文)。置顶沿用同思路(meta.docs.pinned),与 sortIndex/折叠同一存储层。
- **图片 width/align 不入方言(M3 定)**:§10 方言表无宽度语法,不擅自扩;两者是会话级视图属性,重启即回原始尺寸(≤正文宽),持久化与 HTML 导出均不带。PRD §10 未加条目 = 明确不加。**表格列宽同口径**:`colwidth` 仅编辑会话内,GFM 管道表无法表达,保存重开后均分。
- **左栏入口归置(语雀式,2026-10-30)**:新建收敛为头部单个「+」下拉(文档/文件夹);回收站为低频入口,挪到左栏底部文字项;头部仅「+」「⋯」两个 icon。**lucide 1.x 里 `Trash` 与 `Trash2` 是同一图形**(带桶内两竖线,14px 细线下轮廓碎),无更干净的桶形候选,回收站图标改为 `DocTree.tsx` 自绘 `TrashGlyph`(盖沿+提手+锥形桶身)。**2026-10-31 用户反馈再收敛:树头部「⋯」整个移除**——导入 Markdown/导出当前文档/导出离线 HTML 三项移入原生菜单「文件」(最近打开与设置之间);重建索引只留设置(搜索分区)与搜索空态。**后续(全主题视觉优化)左栏齿轮已移除**,设置只走原生菜单 `⌘,` / 文件菜单。无文档时菜单导出 toast「未打开文档」。冒烟 `menu-smoke.js` 过;**菜单条目本身需真机肉眼**

## 关闭窗口保持后台(2026-11-03)✅

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| 设置开关 | ✅ | 通用 →「关闭窗口时保持后台」,默认关;`settings.closeToTray` |
| 系统托盘 | ✅ | Tauri `tray-icon`:开设置即建托盘;左键打开主窗;菜单「打开砚知 / 退出砚知」;**单实例**(`tauri-plugin-single-instance`,2026-11-03):关到托盘后再点桌面图标唤起已有窗,不新开进程/托盘;二次启动带 `.md` 转前台打开 |
| 关窗行为 | ✅ | 开:冲刷后 `hide`;关:走真退出。`CloseRequested` 一律先 prevent 再由前端分支 |
| 真退出 | ✅ | 菜单退出 / 托盘退出 → `ExitRequested` 拦下发 `yz-app-quit` → 前端确认后 `quit_app`(QuitArmed) |
| 保存策略 | ✅ | 知识库 `flushSave` 静默落盘;单文件 dirty 弹保存/放弃/继续(挂后台放弃=重载磁盘版清 dirty) |

## V3 AI 助手 BYOK(2026-11-02)✅ AI-0 + AI-1;2026-11-03 追加 AI-2/AI-3

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| 设置「AI 助手」 | ✅ | 总开关/Base URL/模型(温度与 max tokens 保留内部默认值,设置页不展示);三步配置流(服务商→Key 连接→选择模型),`GET /models` 拉取列表,失败回落内置模型/手填;顶部按未开启/检查 Key/连接/选模型/待测试/配置成功展示阶段进度,关闭总开关时收起配置;Kimi Coding 走 Anthropic Messages;契约条(左侧主色描边);Key 进系统钥匙串(`keyring`)+App Data 0600 本机缓存,不进 settings.json/知识库 |
| 请求层 | ✅ | Rust `ai_chat`/`ai_test_connection`/`ai_cancel`/`ai_list_models`(reqwest+可取消);仅 https 或本机 http;浏览器 mock=localStorage+fetch |
| 选区浮动条 | ✅ | `SelectionBubble`:未开 AI 时格式全开(粗体/斜体/高亮/颜色/链接);AI 就绪时收起斜体与颜色,露出润色/扩写/缩写 +「更多 ▾」(2026-11-05 迁 Radix Dropdown,语气/语言/公式走二级菜单并统一菜单视觉);文案 `whitespace-nowrap` 防竖排;`AiChrome` 承接结果条与右键 |
| 右键 AI 子菜单 | ✅ | 选区右键;无选区可续写;「更多/右键」按上下文分写作/结构/卡片 |
| 斜杠 `/ai` | ✅ | 斜杠菜单 AI 分组,关键词含 ai;未配置时先弹确认「稍后再说 / 去配置」,确认后再打开设置 AI 页 |
| 结果三按钮 | ✅ | 插入/替换/仅复制(确认后写回);双链建议逐条可点插入;请求中轻量胶囊可取消 |
| AI-1 动作 | ✅ | 润色/续写/扩写/缩写/改语气/翻译/解释/纠错/总结为要点 |
| AI-2 结构 | ✅ | 生成大纲/整理结构(拆段+小标题,保留「拆段/小标题」搜索别名)/提取待办/整理为表格/双链建议(库内文档名过滤) |
| AI 起标题 | ✅ | 标题栏 Sparkles 入口;点击即请求(状态栏明示 host,当前文开头最多 12,000 Unicode 字符;气泡只显示生成状态并可取消);最多 3 候选,本地清洗 Markdown/非法字符/`.md`/长度;点击候选才走 `rename_entry`(联动双链/meta/索引/快照),同名后缀 toast;切文档取消、内容变化禁止应用。2026-11-05:去掉发送前二次确认;请求中复用选区 AI 的 Sparkles 脉冲 + 三点动画,不展示发送量/host;起标题不再把 max tokens 压到 192(GLM-5.3 等推理模型的 reasoning 会吃掉预算导致最终 content 为空),改用全局 AI 输出上限 |
| AI-3 卡片 | ✅ | 解释代码(插入)/改写代码(替换节点内容)/生成 Mermaid(选区 NL→围栏)/修正 Mermaid/生成公式(行内\|块级);代码块卡片 hover「AI」入口;`applyMode` 分流回写;多代码块时卡片显式传 `nodePos`,解释插在该块后方。2026-11-05 真机冒烟通过(润色 + 结构 + AI 起标题 + 卡片) |

未做(按 PRD 分期):右侧 AI 面板、AI-4 库级(默认不做)。`⌘/Ctrl+Shift+A` 打开 AI 动作菜单已做(可改键,见快捷键说明)。

## 下一步开工

1. **托盘真机抽检**:设置开启 → 关窗进托盘 → 左键恢复 → 托盘退出;单文件 dirty 关窗/退出确认;知识库关窗后内容已落盘
2. **M4 尾项**:IME 真机回归;安装包签名/公证
3. PDF 导出暂缓;只读源码视图明确不做

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
- **Windows 辅助窗 / 原生对话框叠开(2026-11-02 真机)**:① `WebviewWindowBuilder::build` 在**同步** command 里会死锁 → 白屏且关不掉,`open_aux_window` 必须 `async` + `AuxWindowLock` 双检防同 label 竞态;② `app.emit("kb-menu")` 会广播到所有 webview,只应 `main.emit`;③ 前端 `await listen` + 不稳定 deps 的 useEffect,清理时 `un` 常未赋值 → handler 泄漏 → 一点菜单弹出多个对话框/窗口(mac 不明显、Win 放大)。菜单/图谱/设置桥用 **ref + 只订一次 + disposed**;选文件/另存为等走 `withNativeDialog` 全局互斥(`dialog-gate.ts`)。菜单「关于」mac 只在应用菜单、Win 只在帮助,勿双端各塞一份
- **Windows 应用菜单勿照搬 mac 角色项**:Services / Hide / Hide Others 在 Win 上灰掉无意义;「砚知」菜单 Win 侧只留设置 + 退出
- **Windows WebView2 吞菜单 accelerator**:获焦时 `CmdOrCtrl+S/O/,` 等菜单加速键常不进 muda 事件 → 单文件 Ctrl+S「没反应」。前端对 Win/浏览器桥接这些键,macOS Tauri 仍只走原生菜单防双触发(`App.tsx` `bridgeMenuShortcuts`)
- **Windows 辅助窗勿继承主菜单栏**:`app.set_menu` 后新建窗会带「砚知/文件/编辑…」,设置/帮助/图谱不需要。`open_aux_window` 建窗后 `remove_menu()` 再 `show`(mac 菜单在系统栏,此 API 无效,保持原样)
- **辅助窗分层**:设置/快捷键用 `WebviewWindowBuilder::parent(&main)`(owner,始终压主窗之上、随主窗最小化);帮助/图谱不挂 parent,可与主窗并排切换。已开窗聚焦只 `set_focus`,冷启才建 parent 关系
- **Tauri 2 invoke 参数**:JS camelCase ↔ Rust snake_case 自动映射(folderRel → folder_rel),双端命名按各自习惯即可;**但返回值 serde 不映射**——Rust 结构体字段默认 snake_case 序列化,前端读 camelCase 会静默 undefined(TreeNode.is_dir 断裂实录,手测才发现:mock 后端 camelCase 验不出)。跨端结构体要么 `#[serde(rename_all = "camelCase")]` 要么逐字段 rename
- **mock 库首开文档是树序第一篇**(随笔/第一篇,不是开始使用):树序 = 文件夹递归在前。E2E 脚本要先点树切到目标文档再断言,同文档点击会被 openDoc 的 `rel===cur` 守卫拦下(行为正确,脚本易误判)
- **macOS Option 组合快捷键的 `e.key` 是特殊字符**(⌥F → `ƒ`):判断组合键用 `e.code === "KeyF"`,别用 e.key;浮层类组件的 Esc 关闭挂 window 级,不能只挂在 input(焦点在按钮/正文时也要能关);**同修饰键家族的快捷键必须互斥检查**(⌘F 查找没排除 shift → ⌘⇧F 专注模式把查找条也一起打开;两个 handler 都挂 window,preventDefault 不拦其它 listener)
- **WKWebView 的 navigator.clipboard.write 对 text/html 不稳**(手测实录:复制带表格文档贴出只剩拍平文本):富文本/纯文本复制统一走 tauri-plugin-clipboard-manager(`writeHtml(html, 纯文本回退)`,capabilities 加 allow-write-text/allow-write-html);且 getHTML 输出无样式,贴到微信/邮件必须先 `inlineStyles` 注入内联样式(无边框表格观感即"结构丢了")
- **清华 crates.io 镜像对 index 请求 403(2026-10-31 实录)**:`mirrors.tuna.tsinghua.edu.cn/crates.io-index/config.json` 被拒(HTML 拒绝页),拉新 crate 必挂;已切 USTC(`src-tauri/.cargo/config.toml`,sparse+https://mirrors.ustc.edu.cn/crates.io-index/,curl 200 实测)。已缓存的 crate 不走 index 不受影响,所以平时无感、加新依赖才炸
- 修改任何解析/序列化行为:**必须跑全量 fixtures**(`pnpm test`,当前 157/157)
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
- **TipTap 默认斜体 `_…_` 粘贴/输入规则会吞标识符**(实录:`_SPECIAL_LABEL` → 斜体 SPECIAL + LABEL,界面像 SPECIALLABEL);砚知序列化本就用 `*…*`,已换 `ItalicAsteriskOnly` 只保留星号规则(2026-11-05)
- **md-it 默认 `normalizeLink` 会把非 ASCII 链接目标百分号编码**(附件批实录:`./随笔/第一篇.md` 落盘变 `%E9%9A%8F…`,静默改写用户原文,违反 §4.4)——覆写 `md.normalizeLink = (url) => url` 关闭;`validateLink` 是另一个函数不受影响。同批:**StarterKit 内置的扩展不是项目的直接依赖**,pnpm 严格解析下 import 直接 resolve 失败(`@tiptap/extension-link` 实录),要显式 `pnpm add` 并重启 dev(与 Shiki 依赖同款坑)

## 遗留小事项

- 打包版右键菜单中文:dev 裸二进制常为英文(正常);以 `pnpm tauri build` 产物验证
- 主 bundle 1MB+:语言分包已做,入口级 code-split 可后续做(不阻塞)
