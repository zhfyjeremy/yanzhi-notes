mod kb;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 显示菜单勾选态:状态源在前端(App state / settings.json),Rust 只镜像,
/// 前端变化时经 set_view_state 回写并重建菜单(勾选标记与界面一致)
#[derive(Clone, Copy)]
struct ViewFlagsInner {
    panel: bool,
    toolbar: bool,
    focus: bool,
}

impl Default for ViewFlagsInner {
    fn default() -> Self {
        Self { panel: true, toolbar: true, focus: false }
    }
}

#[derive(Default)]
struct ViewFlags(std::sync::Mutex<ViewFlagsInner>);

/// 应用菜单(参考 Typora,全量中文重建):砚知 / 文件 / 编辑 / 显示 / 窗口。
/// 编辑与窗口用预定义项(快捷键、系统行为由 OS 接管);文件/显示里的自定义项
/// 经 `kb-menu` 事件转发前端执行。recent 列表取自 recent.json,set_recent 时整体重建。
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let app_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| app.package_info().name.clone());

    let mut file = SubmenuBuilder::new(app, "文件")
        .item(&MenuItem::with_id(app, "yz_new_kb", "新建知识库…", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "yz_open_kb", "打开知识库…", true, None::<&str>)?)
        .separator();
    let recent = kb::read_recent(app).recent;
    if recent.is_empty() {
        file = file.item(&MenuItem::with_id(app, "yz_recent_none", "暂无最近打开", false, None::<&str>)?);
    } else {
        // id 只带序号:路径放 id 里会被 muda 净化,事件侧按序号回查 recent.json
        for (i, root) in recent.iter().take(10).enumerate() {
            file = file.item(&MenuItem::with_id(app, format!("yz_recent::{i}"), root, true, None::<&str>)?);
        }
    }
    let file = file
        .separator()
        .item(&MenuItem::with_id(app, "yz_settings", "设置…", true, None::<&str>)?)
        .build()?;

    // macOS 第一个子菜单即「应用」菜单(系统自动加粗与角色)
    let app_submenu = SubmenuBuilder::new(app, &app_name)
        .item(&MenuItem::with_id(
            app,
            "yz_about",
            format!("关于{app_name}…"),
            true,
            None::<&str>,
        )?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;

    let edit = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // 显示勾选项:右侧面板(大纲+反链)/ 工具栏 / 专注模式,默认前两者开。
    // 专注模式不加菜单快捷键:⌘⇧F 已由前端接管,菜单加速键会与 webview 双触发
    let flags = *app.state::<ViewFlags>().0.lock().unwrap();
    let view = SubmenuBuilder::new(app, "显示")
        .item(&CheckMenuItem::with_id(
            app,
            "yz_view_panel",
            "右侧面板",
            true,
            flags.panel,
            None::<&str>,
        )?)
        .item(&CheckMenuItem::with_id(
            app,
            "yz_view_toolbar",
            "工具栏",
            true,
            flags.toolbar,
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
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "窗口")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    // 帮助:快捷键参考;关于入口在应用菜单(macOS 惯例),Windows 补在帮助里
    #[cfg(not(target_os = "macos"))]
    let help_menu = SubmenuBuilder::new(app, "帮助")
        .item(&MenuItem::with_id(app, "yz_help_keys", "快捷键说明…", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(
            app,
            "yz_about_help",
            format!("关于{app_name}…"),
            true,
            None::<&str>,
        )?)
        .build()?;
    #[cfg(target_os = "macos")]
    let help_menu = SubmenuBuilder::new(app, "帮助")
        .item(&MenuItem::with_id(app, "yz_help_keys", "快捷键说明…", true, None::<&str>)?)
        .build()?;

    let menu = Menu::with_items(app, &[&app_submenu, &file, &edit, &view, &window, &help_menu])?;
    app.set_menu(menu)?;
    Ok(())
}

/// 打开辅助独立窗口(label = settings / shortcuts):已开则聚焦。
/// settings 的 tab 用于直落分类(如「关于砚知」)。浏览器 dev 无多窗,
/// 前端回落 Dialog,不走此命令。
#[tauri::command]
fn open_aux_window(app: tauri::AppHandle, label: String, tab: Option<String>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
        if label == "settings" && tab.is_some() {
            let _ = app.emit("yz-settings-tab", tab.unwrap_or_default());
        }
        return Ok(());
    }
    let (title, w, h, resizable) = match label.as_str() {
        "shortcuts" => ("快捷键说明", 460.0, 600.0, false),
        _ => ("设置", 780.0, 560.0, true),
    };
    let mut url = format!("index.html#/{label}");
    if let Some(t) = &tab {
        url.push_str(&format!("?tab={t}"));
    }
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(w, h)
        .center()
        .resizable(resizable);
    if resizable {
        builder = builder.min_inner_size(680.0, 500.0);
    }
    builder.build().map(|_| ()).map_err(|e| e.to_string())
}

/// 前端状态变化后回写显示菜单勾选态(菜单点击 → 前端应用 → 回写 → 重建勾)
#[tauri::command]
fn set_view_state(app: tauri::AppHandle, panel: Option<bool>, toolbar: Option<bool>, focus: Option<bool>) {
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
    }
    let _ = build_app_menu(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(kb::WatchState(std::sync::Mutex::new(None)))
        .manage(ViewFlags::default())
        .setup(|app| {
            build_app_menu(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            let payload = if id == "yz_new_kb" {
                serde_json::json!({ "action": "new" })
            } else if id == "yz_open_kb" {
                serde_json::json!({ "action": "open" })
            } else if id == "yz_settings" {
                serde_json::json!({ "action": "settings" })
            } else if id == "yz_about" || id == "yz_about_help" {
                serde_json::json!({ "action": "about" })
            } else if id == "yz_help_keys" {
                serde_json::json!({ "action": "help-keys" })
            } else if id == "yz_view_panel" || id == "yz_view_toolbar" || id == "yz_focus" {
                // 勾选项:发出「目标值 = !当前镜像」;前端应用后回写 set_view_state 翻勾
                let flags = *app.state::<ViewFlags>().0.lock().unwrap();
                match id {
                    "yz_view_panel" => serde_json::json!({ "action": "view", "key": "panel", "value": !flags.panel }),
                    "yz_view_toolbar" => serde_json::json!({ "action": "view", "key": "toolbar", "value": !flags.toolbar }),
                    _ => serde_json::json!({ "action": "view", "key": "focus", "value": !flags.focus }),
                }
            } else if let Some(i) = id.strip_prefix("yz_recent::").and_then(|s| s.parse::<usize>().ok()) {
                match kb::read_recent(app).recent.get(i) {
                    Some(root) => serde_json::json!({ "action": "open-recent", "root": root }),
                    None => return, // 菜单与 recent.json 短暂不同步(重建中),忽略
                }
            } else {
                return;
            };
            let _ = app.emit("kb-menu", payload);
        })
        .invoke_handler(tauri::generate_handler![
            open_aux_window,
            set_view_state,
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
            kb::get_recent,
            kb::set_recent,
            kb::set_last_doc,
            kb::read_all_docs,
            kb::save_asset,
            kb::import_asset,
            kb::pick_images,
            kb::pick_files,
            kb::open_path,
            kb::pick_docs,
            kb::read_asset_base64,
            kb::list_trash,
            kb::restore_trash,
            kb::purge_trash,
            kb::empty_trash,
            kb::read_all_trash_docs,
            kb::list_history,
            kb::read_history,
            kb::save_snapshot,
            kb::import_docs,
            kb::export_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
