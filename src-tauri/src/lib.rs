mod kb;

use tauri::menu::{Menu, MenuItem, SubmenuBuilder};
use tauri::Emitter;

/// 应用菜单(PRD 5.0.4-2):保留系统默认菜单,在「应用」之后插入
/// 「文件 → 新建知识库 / 打开知识库 / 最近打开」。recent 列表取自
/// recent.json,set_recent 时整体重建;点击经 `kb-menu` 事件转发前端执行。
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
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
    let submenu = file.build()?;
    let menu = Menu::default(app)?;
    // macOS 索引 1 = 「应用」菜单后;默认菜单为空的平台(插入越界)退化为追加
    if menu.insert(&submenu, 1).is_err() {
        menu.append(&submenu)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(kb::WatchState(std::sync::Mutex::new(None)))
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
            kb::pick_docs,
            kb::read_asset_base64,
            kb::list_trash,
            kb::restore_trash,
            kb::purge_trash,
            kb::empty_trash,
            kb::read_all_trash_docs,
            kb::import_docs,
            kb::export_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
