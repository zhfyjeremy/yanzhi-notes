//! Windows 上把 .md / .markdown 的文件图标指到安装目录里的 file-icon.ico。
//! 应用本身的窗口、任务栏、快捷方式仍用 exe 图标。

#[cfg(windows)]
use std::path::{Path, PathBuf};

use tauri::AppHandle;
#[cfg(windows)]
use tauri::Manager;

/// 已安装的砚知被设为默认打开方式时,把该关联的 DefaultIcon 改成文档卡。
/// 开发进程的 exe 路径对不上现有关联时什么都不写。
pub fn sync_installed_file_icon(app: &AppHandle) {
    #[cfg(windows)]
    sync_installed_file_icon_windows(app);
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
fn sync_installed_file_icon_windows(app: &AppHandle) {
    let Some(source_icon) = locate_file_icon(app) else {
        return;
    };
    let Ok(classes) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "Software\\Classes",
            winreg::enums::KEY_READ | winreg::enums::KEY_WRITE,
        )
    else {
        return;
    };

    let mut changed = false;
    for prog_id in ["Markdown", "砚知.md", "砚知.markdown"] {
        if point_prog_icon(&classes, prog_id, &source_icon) {
            changed = true;
        }
    }
    if changed {
        notify_shell();
    }
}

#[cfg(windows)]
fn locate_file_icon(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("file-icon.ico"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("file-icon.ico"));
        }
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/file-icon.ico"));
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(windows)]
fn point_prog_icon(classes: &winreg::RegKey, prog_id: &str, source_icon: &Path) -> bool {
    let Ok(command_key) = classes.open_subkey(format!(r"{prog_id}\shell\open\command")) else {
        return false;
    };
    let Ok(command) = command_key.get_value::<String, _>("") else {
        return false;
    };
    let Some(exe) = exe_from_command(&command) else {
        return false;
    };
    if !exe
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("yanzhi-notes.exe"))
    {
        return false;
    }
    let Some(install_dir) = exe.parent() else {
        return false;
    };
    let installed_icon = install_dir.join("file-icon.ico");
    if installed_icon != source_icon {
        if let Err(err) = std::fs::copy(source_icon, &installed_icon) {
            eprintln!("写入文件图标失败: {err}");
            return false;
        }
    }

    let Ok((icon_key, _)) = classes.create_subkey(format!(r"{prog_id}\DefaultIcon")) else {
        return false;
    };
    let desired = installed_icon.to_string_lossy().to_string();
    let current = icon_key.get_value::<String, _>("").unwrap_or_default();
    if current.trim_matches('"') == desired {
        return false;
    }
    icon_key.set_value("", &desired).is_ok()
}

#[cfg(windows)]
fn exe_from_command(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    if let Some(rest) = command.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some(PathBuf::from(&rest[..end]));
    }
    let token = command.split_whitespace().next()?;
    Some(PathBuf::from(token))
}

#[cfg(windows)]
fn notify_shell() {
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHChangeNotify(event_id: u32, flags: u32, item1: *const (), item2: *const ());
    }
    const SHCNE_ASSOCCHANGED: u32 = 0x0800_0000;
    const SHCNF_FLUSH: u32 = 0x1000;
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH, std::ptr::null(), std::ptr::null());
    }
}
