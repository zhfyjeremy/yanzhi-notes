mod ai;
mod export;
mod file_icon;
mod kb;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{CheckMenuItem, IconMenuItem, Menu, MenuItem, NativeIcon, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 关闭主窗时是否隐藏到托盘(状态源在前端 settings.closeToTray,经 set_close_to_tray 同步)
struct CloseToTray(AtomicBool);
/// 前端完成冲刷/未保存确认后武装退出,ExitRequested 才放行
struct QuitArmed(AtomicBool);

fn show_main_window_inner(app: &tauri::AppHandle) {
    // macOS 若用 NSApplication.hide 收到托盘,单独 window.show 不会自动 unhide 应用。
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn ensure_tray(app: &tauri::AppHandle) -> Result<(), String> {
    if app.tray_by_id("main-tray").is_some() {
        return Ok(());
    }
    let show = MenuItem::with_id(app, "yz_tray_show", "打开砚知", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "yz_tray_quit", "退出砚知", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(|e| e.to_string())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "缺少应用图标,无法创建托盘".to_string())?;
    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("砚知")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "yz_tray_show" => show_main_window_inner(app),
            "yz_tray_quit" => {
                show_main_window_inner(app);
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.emit("yz-app-quit", ());
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window_inner(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_tray(app: &tauri::AppHandle) {
    let _ = app.remove_tray_by_id("main-tray");
}

/// 同步「关闭窗口时保持后台」:开则建托盘,关则移除并确保主窗可见
#[tauri::command]
fn set_close_to_tray(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    app.state::<CloseToTray>()
        .0
        .store(enabled, Ordering::SeqCst);
    if enabled {
        ensure_tray(&app)?;
    } else {
        remove_tray(&app);
        show_main_window_inner(&app);
    }
    Ok(())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    show_main_window_inner(&app);
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    // macOS 直接 orderOut 全屏窗会留下一个空的黑色全屏 Space。走系统级 App Hide,
    // 让 macOS 收起完整 fullscreen space;托盘恢复时先 App Show 再拉起主窗。
    #[cfg(target_os = "macos")]
    {
        let _ = app
            .get_webview_window("main")
            .ok_or_else(|| "主窗口不存在".to_string())?;
        app.hide().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let w = app
            .get_webview_window("main")
            .ok_or_else(|| "主窗口不存在".to_string())?;
        w.hide().map_err(|e| e.to_string())
    }
}

/// 前端冲刷/确认完成后真正退出(武装 QuitArmed,避免 ExitRequested 再拦一次)
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.state::<QuitArmed>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// 显示菜单勾选态:状态源在前端(App state / settings.json),Rust 只镜像,
/// 前端变化时经 set_view_state 回写并重建菜单(勾选标记与界面一致)
#[derive(Clone, Copy)]
struct ViewFlagsInner {
    panel: bool,
    toolbar: bool,
    focus: bool,
    /// 右栏分区独立显隐(2026-10-31):状态源同在前端 settings,Rust 镜像勾选
    outline: bool,
    backlinks: bool,
    tags: bool,
    history: bool,
    /// 单文件轻编辑模式:保存/另存为/关闭/存入知识库仅此态可用(知识库有自动保存)
    single_file: bool,
    /// 单文件左侧大纲显隐(与知识库右栏 showOutline 独立,菜单「大纲」按模式镜像其一)
    single_outline: bool,
    /// 全文档 Markdown 源码模式;没打开文档时菜单项禁用
    source: bool,
    source_enabled: bool,
}

impl Default for ViewFlagsInner {
    fn default() -> Self {
        Self {
            panel: true,
            toolbar: true,
            focus: false,
            outline: true,
            backlinks: true,
            tags: true,
            history: true,
            single_file: false,
            single_outline: true,
            source: false,
            source_enabled: false,
        }
    }
}

#[derive(Default)]
struct ViewFlags(std::sync::Mutex<ViewFlagsInner>);

/// 辅助窗创建互斥:async 命令下并发 invoke 会在 get_webview_window 未登记前
/// 同时 build 同 label,Windows 上出现多原生窗 / "failed to acquire webview reference"。
#[derive(Default)]
struct AuxWindowLock(std::sync::Mutex<()>);

/// 系统「打开方式」/启动参数带来的待打开 Markdown;前端就绪后 take
#[derive(Default)]
struct StartupSingleFile(std::sync::Mutex<Option<String>>);

#[tauri::command]
fn take_startup_single_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(app.state::<StartupSingleFile>().0.lock().unwrap().take())
}

/// 应用菜单(参考 Typora,全量中文重建):砚知 / 文件 / 编辑 / 显示 / 窗口。
/// 编辑与窗口用预定义项(快捷键、系统行为由 OS 接管);文件/显示里的自定义项
/// 经 `kb-menu` 事件转发前端执行。recent 列表取自 recent.json,set_recent 时整体重建。
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let app_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| app.package_info().name.clone());

    let new_kb = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_new_kb",
        "新建知识库…",
        true,
        Some(NativeIcon::Add),
        None::<&str>,
    )?;
    let open_kb = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_open_kb",
        "打开知识库…",
        true,
        Some(NativeIcon::Folder),
        None::<&str>,
    )?;
    let open_single = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_open_single",
        "打开 Markdown 文件…",
        true,
        Some(NativeIcon::MultipleDocuments),
        Some("CmdOrCtrl+O"),
    )?;
    let file = SubmenuBuilder::new(app, "文件")
        .item(&new_kb)
        .item(&open_kb)
        .separator();
    // 最近打开收进子菜单(macOS 惯例「Open Recent ▸」):顶级只占一行,列表 hover 展开
    let recent = kb::read_recent(app).recent;
    let recent_items: Vec<_> = if recent.is_empty() {
        vec![MenuItem::with_id(
            app,
            "yz_recent_none",
            "暂无最近打开",
            false,
            None::<&str>,
        )?]
    } else {
        // id 只带序号:路径放 id 里会被 muda 净化,事件侧按序号回查 recent.json
        recent
            .iter()
            .take(10)
            .enumerate()
            .map(|(i, root)| {
                MenuItem::with_id(app, format!("yz_recent::{i}"), root, true, None::<&str>)
            })
            .collect::<Result<Vec<_>, _>>()?
    };
    let recent_refs: Vec<&dyn tauri::menu::IsMenuItem<_>> = recent_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<_>)
        .collect();
    let recent_menu = SubmenuBuilder::new(app, "打开最近文件夹")
        .items(&recent_refs)
        .submenu_native_icon(NativeIcon::Folder)
        .build()?;
    let recent_files = kb::read_recent_files(app).recent;
    let recent_file_items: Vec<_> = if recent_files.is_empty() {
        vec![MenuItem::with_id(
            app,
            "yz_recent_file_none",
            "暂无最近文件",
            false,
            None::<&str>,
        )?]
    } else {
        recent_files
            .iter()
            .take(10)
            .enumerate()
            .map(|(i, path)| {
                MenuItem::with_id(
                    app,
                    format!("yz_recent_file::{i}"),
                    path,
                    true,
                    None::<&str>,
                )
            })
            .collect::<Result<Vec<_>, _>>()?
    };
    let recent_file_refs: Vec<&dyn tauri::menu::IsMenuItem<_>> = recent_file_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<_>)
        .collect();
    let recent_file_menu = SubmenuBuilder::new(app, "打开最近文件")
        .items(&recent_file_refs)
        .submenu_native_icon(NativeIcon::MultipleDocuments)
        .build()?;
    // 另存为/关闭/存入知识库 = 单文件专用;知识库页灰掉避免「点了没反应」
    let flags = *app.state::<ViewFlags>().0.lock().unwrap();
    let single = flags.single_file;
    // 保存 = 两种模式都可用:单文件写回原文件;知识库立即冲刷自动保存的待写内容
    // (自动保存 2s 去抖,⌘S 给「立刻落盘」的确定感;原先知识库态灰掉是因为点了没反应)
    let save_label = if single { "保存" } else { "立即保存" };
    let save_doc = MenuItem::with_id(app, "yz_save_doc", save_label, true, Some("CmdOrCtrl+S"))?;
    let save_single_as = MenuItem::with_id(
        app,
        "yz_save_single_as",
        "另存为…",
        single,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let close_single = MenuItem::with_id(app, "yz_close_single", "关闭文件", single, None::<&str>)?;
    let save_single_to_kb = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_save_single_to_kb",
        "存入知识库…",
        single,
        Some(NativeIcon::Folder),
        None::<&str>,
    )?;
    let import_md = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_import_md",
        "导入 Markdown…",
        !single,
        Some(NativeIcon::RevealFreestanding),
        None::<&str>,
    )?;
    let export_md = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_export_md",
        "导出 Markdown…",
        true,
        Some(NativeIcon::Share),
        None::<&str>,
    )?;
    let export_html = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_export_html",
        "导出离线 HTML…",
        true,
        Some(NativeIcon::Share),
        None::<&str>,
    )?;
    let export_docx = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_export_docx",
        "导出 Word (.docx)…",
        true,
        Some(NativeIcon::Share),
        None::<&str>,
    )?;
    let export_refs: Vec<&dyn tauri::menu::IsMenuItem<_>> = [&export_md as _, &export_html as _, &export_docx as _]
        .into_iter()
        .collect();
    let export_menu = SubmenuBuilder::new(app, "导出")
        .items(&export_refs)
        .submenu_native_icon(NativeIcon::Share)
        .build()?;

    // 设置:mac 在应用菜单(惯例 + ⌘,);Win 放「文件」末尾,避免标题栏「砚知」旁再挂一级「砚知」菜单
    // 「关于」:macOS 只放应用菜单;Windows 只放「帮助」(见下方 help_menu),避免双入口。
    let settings = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_settings",
        "设置…",
        true,
        Some(NativeIcon::Advanced),
        Some("CmdOrCtrl+,"),
    )?;
    let file = file
        .item(&open_single)
        .separator()
        .item(&recent_menu)
        .item(&recent_file_menu)
        .separator()
        .item(&save_doc)
        .item(&save_single_as)
        .item(&close_single)
        .item(&save_single_to_kb)
        .separator()
        .item(&import_md)
        .item(&export_menu);
    #[cfg(not(target_os = "macos"))]
    let file = file.separator().item(&settings).separator().quit();
    let file = file.build()?;

    #[cfg(target_os = "macos")]
    let app_submenu = {
        let about = IconMenuItem::with_id_and_native_icon(
            app,
            "yz_about",
            format!("关于{app_name}"),
            true,
            Some(NativeIcon::Info),
            None::<&str>,
        )?;
        // macOS 第一个子菜单即「应用」菜单(系统自动加粗与角色)
        SubmenuBuilder::new(app, &app_name)
            .item(&about)
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .separator()
            .quit()
            .build()?
    };

    let edit = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // 显示勾选项:右侧面板(总开关)/ 四个分区(总开关关时置灰)/ 工具栏 / 专注模式。
    // 专注模式不加菜单快捷键:⌘⇧F 已由前端接管,菜单加速键会与 webview 双触发
    let graph = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_graph",
        "文档图谱",
        !single,
        Some(NativeIcon::Network),
        None::<&str>,
    )?;
    // 单文件:右侧面板/反链/标签/历史无意义 → 灰掉;
    // 「大纲」保留并可勾选,镜像左侧单文件大纲(与知识库右栏 outline 独立)。
    let view = SubmenuBuilder::new(app, "显示")
        .item(&CheckMenuItem::with_id(
            app,
            "yz_view_panel",
            "右侧面板",
            !single,
            flags.panel,
            None::<&str>,
        )?)
        .separator()
        .item(&CheckMenuItem::with_id(
            app,
            "yz_view_outline",
            "大纲",
            if single { true } else { flags.panel },
            if single {
                flags.single_outline
            } else {
                flags.outline
            },
            None::<&str>,
        )?)
        .item(&CheckMenuItem::with_id(
            app,
            "yz_view_backlinks",
            "反向链接",
            !single && flags.panel,
            flags.backlinks,
            None::<&str>,
        )?)
        .item(&CheckMenuItem::with_id(
            app,
            "yz_view_tags",
            "标签",
            !single && flags.panel,
            flags.tags,
            None::<&str>,
        )?)
        .item(&CheckMenuItem::with_id(
            app,
            "yz_view_history",
            "历史版本",
            !single && flags.panel,
            flags.history,
            None::<&str>,
        )?)
        .separator()
        .item(&CheckMenuItem::with_id(
            app,
            "yz_view_toolbar",
            "工具栏",
            true,
            flags.toolbar,
            None::<&str>,
        )?)
        .item(&CheckMenuItem::with_id(
            app,
            "yz_view_source",
            "源码模式",
            flags.source_enabled,
            flags.source,
            None::<&str>,
        )?)
        .separator()
        .item(&CheckMenuItem::with_id(
            app,
            "yz_focus",
            "专注模式",
            true,
            flags.focus,
            None::<&str>,
        )?)
        .separator()
        .item(&graph)
        .separator()
        .fullscreen()
        .build()?;

    // 浏览器式标签页:Cmd/Ctrl+W 归「关闭标签页」;关闭窗口用 Shift+W,
    // 避免标准 Close Window 预定义项抢走 Cmd/Ctrl+W。
    let close_tab = MenuItem::with_id(
        app,
        "yz_close_tab",
        "关闭标签页",
        !single,
        Some("CmdOrCtrl+W"),
    )?;
    let close_window = MenuItem::with_id(
        app,
        "yz_close_window",
        "关闭窗口",
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?;
    let window = SubmenuBuilder::new(app, "窗口")
        .minimize()
        .maximize()
        .separator()
        .item(&close_tab)
        .item(&close_window)
        .build()?;

    // 帮助:快捷键参考;关于入口在应用菜单(macOS 惯例),Windows 补在帮助里
    let help_keys = IconMenuItem::with_id_and_native_icon(
        app,
        "yz_help_keys",
        "快捷键说明",
        true,
        Some(NativeIcon::Info),
        None::<&str>,
    )?;
    let help_quick_start =
        MenuItem::with_id(app, "yz_help_quick_start", "快速上手", true, None::<&str>)?;
    let help_markdown = MenuItem::with_id(
        app,
        "yz_help_markdown",
        "Markdown 能力示例",
        true,
        None::<&str>,
    )?;
    let help_docs = SubmenuBuilder::new(app, "使用文档")
        .item(&help_quick_start)
        .item(&help_markdown)
        .submenu_native_icon(NativeIcon::Bookmarks)
        .build()?;
    #[cfg(not(target_os = "macos"))]
    let help_menu = SubmenuBuilder::new(app, "帮助")
        .item(&help_keys)
        .separator()
        .item(&help_docs)
        .separator()
        .item(&MenuItem::with_id(
            app,
            "yz_about_help",
            format!("关于{app_name}"),
            true,
            None::<&str>,
        )?)
        .build()?;
    #[cfg(target_os = "macos")]
    let help_menu = SubmenuBuilder::new(app, "帮助")
        .item(&help_keys)
        .separator()
        .item(&help_docs)
        .build()?;

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        app,
        &[&app_submenu, &file, &edit, &view, &window, &help_menu],
    )?;
    // Windows:菜单从「文件」起,顶栏不再重复产品名(标题栏图标+名已承担品牌)
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file, &edit, &view, &window, &help_menu])?;
    app.set_menu(menu)?;
    Ok(())
}

/// 打开辅助独立窗口(label = settings / shortcuts / help / graph):已开则聚焦。
/// settings 的 tab 用于直落分类(如「关于砚知」)。浏览器 dev 无多窗,
/// 前端回落 Dialog,不走此命令。
///
/// **必须 async**:Windows 上在同步 command / 事件回调里
/// `WebviewWindowBuilder::build` 会与 WebView2 死锁 → 白屏且标题栏关闭无效
/// (见 Tauri `WebviewWindowBuilder::new` Known issues)。
/// 并发创建用 `AuxWindowLock` 双检锁串行化,避免同 label 竞态炸出多窗。
#[tauri::command]
async fn open_aux_window(
    app: tauri::AppHandle,
    label: String,
    tab: Option<String>,
) -> Result<(), String> {
    let focus_existing = |app: &tauri::AppHandle, label: &str, tab: &Option<String>| -> bool {
        let Some(w) = app.get_webview_window(label) else {
            return false;
        };
        let _ = w.set_focus();
        if label == "settings" && tab.is_some() {
            let _ = w.emit("yz-settings-tab", tab.clone().unwrap_or_default());
        } else if label == "help" && tab.is_some() {
            let _ = w.emit("yz-help-doc", tab.clone().unwrap_or_default());
        }
        true
    };
    if focus_existing(&app, &label, &tab) {
        return Ok(());
    }
    let lock = app.state::<AuxWindowLock>();
    let _guard = lock.0.lock().map_err(|_| "辅助窗创建锁异常".to_string())?;
    if focus_existing(&app, &label, &tab) {
        return Ok(());
    }
    let (title, w, h, resizable) = match label.as_str() {
        // 快捷键说明:规格表布局(标题带 + 可改键卡片 + 双列固定条目),加宽并允许用户调整
        "shortcuts" => ("快捷键说明", 800.0, 780.0, true),
        "help" => ("使用文档", 820.0, 620.0, true),
        "graph" => ("文档图谱", 1080.0, 760.0, true),
        _ => ("设置", 780.0, 560.0, true),
    };
    // 设置/快捷键 = 偏好窗:挂主窗 owner/parent,始终压在主窗之上,随主窗最小化;
    // 帮助/图谱 = 工作窗:可与主窗并排,不强制父子层级。
    let owned_by_main = matches!(label.as_str(), "settings" | "shortcuts");
    let mut url = format!("index.html#/{label}");
    if let Some(t) = &tab {
        url.push_str(&format!("?tab={t}"));
    }
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(w, h)
        .center()
        .resizable(resizable)
        // Windows/Linux:先隐藏,去掉从 app 菜单继承的菜单栏后再 show
        // (设置/帮助/图谱不需要「文件/编辑…」);macOS 菜单在系统栏,remove_menu 无效可跳过
        .visible(false);
    if resizable {
        builder = builder.min_inner_size(680.0, 500.0);
    }
    if owned_by_main {
        if let Some(main) = app.get_webview_window("main") {
            builder = builder.parent(&main).map_err(|e| e.to_string())?;
        }
    }
    let win = builder.build().map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = win.remove_menu();
    }
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

/// 前端状态变化后回写显示菜单勾选态(菜单点击 → 前端应用 → 回写 → 重建勾);
/// `single_file` 同步启用/禁用单文件专用菜单项。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn set_view_state(
    app: tauri::AppHandle,
    panel: Option<bool>,
    toolbar: Option<bool>,
    focus: Option<bool>,
    outline: Option<bool>,
    backlinks: Option<bool>,
    tags: Option<bool>,
    history: Option<bool>,
    single_file: Option<bool>,
    single_outline: Option<bool>,
    source: Option<bool>,
    source_enabled: Option<bool>,
) {
    {
        let state = app.state::<ViewFlags>();
        let mut flags = state.0.lock().unwrap();
        if let Some(v) = panel {
            flags.panel = v;
        }
        if let Some(v) = toolbar {
            flags.toolbar = v;
        }
        if let Some(v) = focus {
            flags.focus = v;
        }
        if let Some(v) = outline {
            flags.outline = v;
        }
        if let Some(v) = backlinks {
            flags.backlinks = v;
        }
        if let Some(v) = tags {
            flags.tags = v;
        }
        if let Some(v) = history {
            flags.history = v;
        }
        if let Some(v) = single_file {
            flags.single_file = v;
        }
        if let Some(v) = single_outline {
            flags.single_outline = v;
        }
        if let Some(v) = source {
            flags.source = v;
        }
        if let Some(v) = source_enabled {
            flags.source_enabled = v;
        }
    }
    let _ = build_app_menu(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例:关到托盘后再点桌面图标 → 唤起已有进程,禁止再开一份(多托盘图标)
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window_inner(app);
            // 二次启动若带 .md(打开方式/拖到图标),转给前台实例
            let path = args
                .iter()
                .skip(1)
                .filter(|p| {
                    let lower = p.to_lowercase();
                    (lower.ends_with(".md") || lower.ends_with(".markdown"))
                        && std::path::Path::new(p).is_file()
                })
                .last()
                .cloned();
            if let Some(path) = path {
                *app.state::<StartupSingleFile>().0.lock().unwrap() = Some(path.clone());
                let _ = app.emit("yz-open-single-file", path);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // 窗口记忆(6.4-3):主窗大小/位置自动保存恢复(关闭时落盘 app_config_dir);
        // 主窗 tauri.conf visible:false —— 等本插件 restore 后再 show,避免先闪默认位置再跳;
        // 辅助窗 skip —— 设置/图谱等有固定或最小尺寸,恢复旧状态会破坏布局
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("settings")
                .skip_initial_state("shortcuts")
                .skip_initial_state("help")
                .skip_initial_state("graph")
                .build(),
        )
        .manage(kb::WatchState(std::sync::Mutex::new(None)))
        .manage(ai::AiCancelMap::default())
        .manage(ViewFlags::default())
        .manage(AuxWindowLock::default())
        .manage(StartupSingleFile::default())
        .manage(CloseToTray(AtomicBool::new(false)))
        .manage(QuitArmed(AtomicBool::new(false)))
        .setup(|app| {
            let pending = std::env::args()
                .skip(1)
                .filter(|p| {
                    let lower = p.to_lowercase();
                    (lower.ends_with(".md") || lower.ends_with(".markdown"))
                        && std::path::Path::new(p).is_file()
                })
                .last();
            if let Some(path) = pending {
                *app.state::<StartupSingleFile>().0.lock().unwrap() = Some(path);
            }
            file_icon::sync_installed_file_icon(app.handle());
            build_app_menu(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            // 走 onCloseRequested:仍复用前端关闭确认 / 托盘设置
            if id == "yz_close_window" {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.close();
                }
                return;
            }
            let payload = if id == "yz_new_kb" {
                serde_json::json!({ "action": "new" })
            } else if id == "yz_open_kb" {
                serde_json::json!({ "action": "open" })
            } else if id == "yz_open_single" {
                serde_json::json!({ "action": "open-single" })
            } else if id == "yz_close_tab" {
                serde_json::json!({ "action": "close-tab" })
            } else if id == "yz_save_doc" {
                serde_json::json!({ "action": "save-doc" })
            } else if id == "yz_save_single_as" {
                serde_json::json!({ "action": "save-single-as" })
            } else if id == "yz_close_single" {
                serde_json::json!({ "action": "close-single" })
            } else if id == "yz_save_single_to_kb" {
                serde_json::json!({ "action": "save-single-to-kb" })
            } else if id == "yz_settings" {
                serde_json::json!({ "action": "settings" })
            } else if id == "yz_import_md" {
                serde_json::json!({ "action": "import-md" })
            } else if id == "yz_export_md" {
                serde_json::json!({ "action": "export-md" })
            } else if id == "yz_export_html" {
                serde_json::json!({ "action": "export-html" })
            } else if id == "yz_export_docx" {
                serde_json::json!({ "action": "export-docx" })
            } else if id == "yz_about" || id == "yz_about_help" {
                serde_json::json!({ "action": "about" })
            } else if id == "yz_help_keys" {
                serde_json::json!({ "action": "help-keys" })
            } else if id == "yz_help_quick_start" {
                serde_json::json!({ "action": "help-doc", "doc": "quick-start" })
            } else if id == "yz_help_markdown" {
                serde_json::json!({ "action": "help-doc", "doc": "markdown" })
            } else if id == "yz_graph" {
                serde_json::json!({ "action": "graph" })
            } else if id == "yz_view_panel"
                || id == "yz_view_toolbar"
                || id == "yz_view_source"
                || id == "yz_focus"
                || id == "yz_view_outline"
                || id == "yz_view_backlinks"
                || id == "yz_view_tags"
                || id == "yz_view_history"
            {
                // 勾选项:发出「目标值 = !当前镜像」;前端应用后回写 set_view_state 翻勾。
                // 单文件时「大纲」镜像 single_outline,不碰知识库右栏 outline。
                let flags = *app.state::<ViewFlags>().0.lock().unwrap();
                match id {
                    "yz_view_panel" => serde_json::json!({ "action": "view", "key": "panel", "value": !flags.panel }),
                    "yz_view_toolbar" => serde_json::json!({ "action": "view", "key": "toolbar", "value": !flags.toolbar }),
                    "yz_view_source" => serde_json::json!({ "action": "view", "key": "source", "value": !flags.source }),
                    "yz_view_outline" => {
                        let next = if flags.single_file {
                            !flags.single_outline
                        } else {
                            !flags.outline
                        };
                        serde_json::json!({ "action": "view", "key": "outline", "value": next })
                    }
                    "yz_view_backlinks" => serde_json::json!({ "action": "view", "key": "backlinks", "value": !flags.backlinks }),
                    "yz_view_tags" => serde_json::json!({ "action": "view", "key": "tags", "value": !flags.tags }),
                    "yz_view_history" => serde_json::json!({ "action": "view", "key": "history", "value": !flags.history }),
                    _ => serde_json::json!({ "action": "view", "key": "focus", "value": !flags.focus }),
                }
            } else if let Some(i) = id.strip_prefix("yz_recent::").and_then(|s| s.parse::<usize>().ok()) {
                match kb::read_recent(app).recent.get(i) {
                    Some(root) => serde_json::json!({ "action": "open-recent", "root": root }),
                    None => return, // 菜单与 recent.json 短暂不同步(重建中),忽略
                }
            } else if let Some(i) = id.strip_prefix("yz_recent_file::").and_then(|s| s.parse::<usize>().ok()) {
                match kb::read_recent_files(app).recent.get(i) {
                    Some(path) => serde_json::json!({ "action": "open-recent-single", "path": path }),
                    None => return,
                }
            } else {
                return;
            };
            // 只发给主窗:辅助窗若误挂 App 也会听 kb-menu,广播会一对多放大成多窗
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.emit("kb-menu", payload);
            } else {
                let _ = app.emit("kb-menu", payload);
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_aux_window,
            set_view_state,
            set_close_to_tray,
            show_main_window,
            hide_main_window,
            quit_app,
            kb::pick_folder,
            kb::create_kb,
            kb::force_create_kb,
            kb::open_kb,
            kb::scan_tree,
            kb::read_doc,
            kb::write_doc,
            kb::create_doc,
            kb::create_folder,
            kb::move_to_trash,
            kb::rename_entry,
            kb::move_entry,
            kb::get_settings,
            kb::set_settings,
            kb::read_meta,
            kb::write_meta,
            kb::read_workspace,
            kb::write_workspace,
            kb::get_recent,
            kb::set_recent,
            kb::get_recent_files,
            kb::set_recent_file,
            kb::set_last_doc,
            kb::pick_single_file,
            kb::read_single_file,
            kb::write_single_file,
            kb::save_single_file_as,
            kb::watch_single_file,
            kb::close_single_file,
            kb::save_single_to_kb,
            kb::save_single_draft,
            kb::get_single_draft,
            kb::clear_single_draft,
            take_startup_single_file,
            kb::read_all_docs,
            kb::save_asset,
            kb::import_asset,
            kb::pick_images,
            kb::pick_files,
            kb::open_path,
            kb::list_templates,
            kb::read_template,
            kb::write_template,
            kb::delete_template,
            kb::open_templates_dir,
            kb::pick_docs,
            kb::read_asset_base64,
            kb::list_assets,
            kb::delete_assets,
            kb::list_trash,
            kb::restore_trash,
            kb::purge_trash,
            kb::empty_trash,
            kb::read_all_trash_docs,
            kb::list_history,
            kb::read_history,
            kb::save_snapshot,
            kb::prune_history,
            ai::set_ai_key,
            ai::clear_ai_key,
            ai::has_ai_key,
            ai::ai_list_models,
            ai::ai_test_connection,
            ai::ai_chat,
            ai::ai_cancel,
            kb::import_docs,
            kb::export_text,
            export::detect_pandoc,
            export::pick_export_path,
            export::pick_docx_output_path,
            export::export_docx,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match &event {
                // 菜单「退出」/系统退出:先交给前端冲刷与单文件未保存确认,确认后再 quit_app
                tauri::RunEvent::ExitRequested { api, .. } => {
                    if !app.state::<QuitArmed>().0.load(Ordering::SeqCst) {
                        api.prevent_exit();
                        show_main_window_inner(app);
                        if let Some(main) = app.get_webview_window("main") {
                            let _ = main.emit("yz-app-quit", ());
                        }
                    }
                }
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    let path = urls.iter().find_map(|url| {
                        url.to_file_path()
                            .ok()
                            .map(|p| p.to_string_lossy().to_string())
                    });
                    if let Some(path) = path {
                        *app.state::<StartupSingleFile>().0.lock().unwrap() = Some(path.clone());
                        let _ = app.emit("yz-open-single-file", path);
                    }
                }
                // macOS:主窗 hide 后点 Dock 图标会 Reopen;无可见窗时拉回主窗
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                    if !has_visible_windows {
                        show_main_window_inner(app);
                    }
                }
                _ => {}
            }
        });
}
