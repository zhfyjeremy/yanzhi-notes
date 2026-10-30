mod kb;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(kb::WatchState(std::sync::Mutex::new(None)))
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
