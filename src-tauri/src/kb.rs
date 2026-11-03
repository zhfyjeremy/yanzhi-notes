//! 知识库文件系统命令(PRD §5.2/§9):所有路径以「库根 + 相对路径」定位,
//! Rust 侧用 std::fs 直读直写(非沙盒分发,无 scoped bookmark 需求)。
//! 命令返回 Result<_, String>:前端拿到的是可读错误信息。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

/// 目录树节点(前端直接渲染;相对路径统一 POSIX 风格 `/` 分隔)。
/// 字段名序列化为 camelCase 与前端 TreeNode 对齐(serde 默认 snake_case 会静默断裂)
#[derive(Serialize, Clone)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 相对路径 → 绝对路径,并拒绝 `..` 逃逸出库根
fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim_start_matches('/');
    let p = Path::new(root).join(rel);
    let normalized = p.canonicalize().map_err(err)?.to_string_lossy().to_string();
    let root_canon = Path::new(root)
        .canonicalize()
        .map_err(err)?
        .to_string_lossy()
        .to_string();
    if !normalized.starts_with(&root_canon) {
        return Err(format!("路径越界: {rel}"));
    }
    Ok(PathBuf::from(normalized))
}

/// 相对路径 → 绝对路径,目标**允许不存在**(恢复/另存场景):只 canonicalize 父目录
fn resolve_new(root: &str, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(root).join(rel.trim_start_matches('/'));
    let parent = p.parent().ok_or("无父目录")?;
    let canon_parent = parent.canonicalize().map_err(err)?;
    let root_canon = Path::new(root)
        .canonicalize()
        .map_err(err)?
        .to_string_lossy()
        .to_string();
    if !canon_parent.starts_with(&root_canon) {
        return Err(format!("路径越界: {rel}"));
    }
    let name = p.file_name().ok_or("无文件名")?;
    Ok(canon_parent.join(name))
}

/// 相对路径(库根下,POSIX 风格)。
/// Windows 上 canonicalize 会加 `\\?\` 前缀,raw root 与 canon abs 直接 strip 会失败,
/// 失败时若直接返回 abs 会把绝对路径漏给前端 → 改名后 currentPath 对不上树、sortIndex 全失效。
fn rel_posix(root: &Path, abs: &Path) -> String {
    let to_posix = |p: &Path| p.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
    if let Ok(rel) = abs.strip_prefix(root) {
        return to_posix(rel);
    }
    if let (Ok(rc), Ok(ac)) = (root.canonicalize(), abs.canonicalize()) {
        if let Ok(rel) = ac.strip_prefix(&rc) {
            return to_posix(rel);
        }
    }
    to_posix(abs)
}

/// 同目录改名:用旧相对路径拼新文件名,不依赖 abs strip(见 rel_posix 注释)
fn rel_after_rename(old_rel: &str, new_filename: &str) -> String {
    match old_rel.rsplit_once('/') {
        Some((parent, _)) => format!("{parent}/{new_filename}"),
        None => new_filename.to_string(),
    }
}

/// 递归扫描;跳过隐藏目录、`.yanzhi`、`assets`、`node_modules`(它们不是文档)
fn scan_dir(root: &Path, dir: &Path) -> Result<Vec<TreeNode>, String> {
    let mut folders = Vec::new();
    let mut docs = Vec::new();
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().to_string();
        let skip =
            name.starts_with('.') || name == "assets" || name == "node_modules" || name == "trash";
        if skip {
            continue;
        }
        let ft = entry.file_type().map_err(err)?;
        if ft.is_dir() {
            let children = scan_dir(root, &entry.path())?;
            folders.push(TreeNode {
                name: name.clone(),
                path: rel_posix(root, &entry.path()),
                is_dir: true,
                children,
            });
        } else if name.to_lowercase().ends_with(".md") {
            docs.push(TreeNode {
                name: name
                    .trim_end_matches(".md")
                    .trim_end_matches(".MD")
                    .to_string(),
                path: rel_posix(root, &entry.path()),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }
    // 文件夹在前,各自按名称排序(中文按 Unicode 码位,M3 后续可换 meta.sortIndex)
    folders.sort_by(|a, b| a.name.cmp(&b.name));
    docs.sort_by(|a, b| a.name.cmp(&b.name));
    folders.extend(docs);
    Ok(folders)
}

/// 9.2 非法字符过滤:Win/macOS 交集 + 首尾空格 + 尾部 `.`
pub fn sanitize_title(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !r#"\/:*?"<>|"#.contains(*c))
        .collect::<String>()
        .trim()
        .trim_end_matches('.')
        .to_string();
    if cleaned.is_empty() {
        "未命名文档".to_string()
    } else {
        cleaned
    }
}

/// 同目录下找不冲突的名字:冲突自动追加 ` (2)`、` (3)`(PRD 5.1,不覆盖)。
/// `except`:重命名场景的原文件自身,不算冲突。
fn dedupe(dir: &Path, title: &str, ext: &str, except: Option<&Path>) -> String {
    let mut candidate = format!("{title}{ext}");
    let mut n = 2;
    while dir.join(&candidate).exists() && Some(dir.join(&candidate).as_path()) != except {
        candidate = format!("{title} ({n}){ext}");
        n += 1;
    }
    candidate
}

fn ensure_yanzhi(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root.join(".yanzhi")).map_err(err)?;
    fs::create_dir_all(root.join(".yanzhi/trash")).map_err(err)?;
    if !root.join(".yanzhi/meta.json").exists() {
        fs::write(
            root.join(".yanzhi/meta.json"),
            r#"{"version":1,"docs":{},"folders":{}}"#,
        )
        .map_err(err)?;
    }
    Ok(())
}

const STARTER_MD: &str = r#"# 开始使用

> [!INFO] 这份文档本身就是示例
> 你看到的标题、列表、表格、代码块都是标准 Markdown。可以直接编辑它,也可以随时删除它。

## 1. 内容存在哪里

砚知把笔记存在你选择的本地文件夹里,不上云、无账号。

- 知识库 = 你指定的一个普通文件夹
- `.md` 是标准 Markdown 文档,其它编辑器也能直接打开
- 图片和附件保存在文档所在文件夹的 `assets` 里
- `.yanzhi` 只保存软件偏好与回收站,删除它不会影响正文
- 复制整个文件夹 = 备份,也能直接带到另一台电脑

## 2. 先试几个常用排版

**加粗**、*斜体*、~~删除线~~、`行内代码`,以及 ==重点高亮==。

- 无序列表:按 Enter 自动延续
    1. 有序列表
    2. 任务与表格可以混在日常笔记里
- [ ] 勾选一个任务
- [x] 已完成任务

> 引用适合放摘录或补充说明。

| 能力 | 输入方式 | 常见用途 |
| --- | --- | --- |
| 标题 | 输入 `/` 或使用工具栏 | 整理论文、方案、日记结构 |
| 任务列表 | 输入 `/` 或待办按钮 | 记录行动项 |
| 表格 | 输入 `/` 插入表格 | 对比、清单、数据 |
| 双链 | 输入 `[[` | 把资料连成网络 |

## 3. 把资料连接起来

输入 `[[` 可以引用知识库里的文档,例如 [[开始使用]]。标签在右侧面板维护,适合做项目、主题和状态筛选;大纲会随标题自动生成。

## 4. 插入图片、附件和代码

输入 `/` 打开插入菜单,可以插入图片、附件、表格、代码块、引用和分割线。图片会保存为相对路径,不会嵌进 Markdown 正文。

```ts
// 代码块支持语言高亮、行号和复制
const note = "标准 Markdown,换电脑也能打开";
console.log(note);
```

## 5. 看看底层 Markdown

砚知是所见即所得编辑器,但文件本体始终是标准 Markdown。下面这段源码可以和上面的排版对照着看:

```md
# 一级标题

**加粗** 和 ==高亮==

- [ ] 任务项

| 列一 | 列二 |
| --- | --- |
| 表格 | 内容 |

[[目标文档]]
```

## 6. 继续探索

- 左栏顶部可以切换知识库、返回欢迎页或打开 Markdown 文件
- 右栏有标签、大纲、反向链接和历史版本
- 删除文档会先进回收站,不怕误删
- 帮助菜单里还有「使用文档」和快捷键说明
"#;

/// async 命令:跑在运行时线程,blocking_pick_folder 不会卡主线程事件循环。
/// 默认定位「文档」目录(5.0.2 推荐不强制;定位失败静默用系统默认)。
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Ok(docs) = app.path().document_dir() {
            if docs.is_dir() {
                dialog = dialog.set_directory(docs);
            }
        }
        dialog.blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|f| f.to_string());
    Ok(picked)
}

/// 新建知识库(5.0.2):空目录 → 基础结构;已含 .yanzhi → 报错引导「打开」
#[tauri::command]
pub fn create_kb(root: &str) -> Result<(), String> {
    let root = Path::new(root);
    if !root.exists() {
        return Err("目录不存在".into());
    }
    let has_yanzhi = root.join(".yanzhi").exists();
    let is_empty = fs::read_dir(root).map_err(err)?.next().is_none();
    if has_yanzhi {
        return Err("该文件夹已是砚知知识库,请改用「打开知识库」".into());
    }
    if !is_empty {
        return Err("NOT_EMPTY".into()); // 前端弹确认:「仍要在此创建」时 force_create_kb
    }
    force_create_kb(root.to_string_lossy().as_ref())
}

#[tauri::command]
pub fn force_create_kb(root: &str) -> Result<(), String> {
    let root = Path::new(root);
    ensure_yanzhi(root)?;
    let starter = dedupe(root, "开始使用", ".md", None);
    fs::write(root.join(starter), STARTER_MD).map_err(err)?;
    Ok(())
}

/* ---------------- 文件监听(5.2.6 notify 去抖) ---------------- */

/// 活跃 watcher(open_kb 换库时 drop 旧的即停止监听;rx 线程随断开退出)
pub struct WatchState(pub Mutex<Option<notify::RecommendedWatcher>>);

/// 静默窗口:事件停 400ms 才汇总发射(写自己/保存器抖动都会产生连发事件)
const FS_QUIET_MS: u64 = 400;

/// 递归监听库根;`.yanzhi/` 内的变动不进事件(meta/回收站写盘不触发重载)。
/// 发射 `kb-fs-event`:Vec<相对路径>(md/目录/assets 均可能在内,由前端按需消费)。
fn watch_kb(app: &tauri::AppHandle, root: &str) -> Result<(), String> {
    use notify::Watcher;
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx).map_err(err)?;
    watcher
        .watch(Path::new(root), notify::RecursiveMode::Recursive)
        .map_err(err)?;

    let thread_app = app.clone();
    let root = root.to_string();
    std::thread::spawn(move || {
        let mut pending: Vec<String> = Vec::new();
        loop {
            match rx.recv_timeout(Duration::from_millis(FS_QUIET_MS)) {
                Ok(Ok(ev)) => {
                    for p in ev.paths {
                        let Some(rel) = p.to_str() else { continue };
                        let Ok(rel) = Path::new(&root)
                            .join(rel)
                            .strip_prefix(&root)
                            .map(|r| r.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/"))
                        else {
                            continue;
                        };
                        if rel.starts_with(".yanzhi/") {
                            continue;
                        }
                        if !pending.contains(&rel) {
                            pending.push(rel);
                        }
                    }
                }
                Ok(Err(_)) => continue, // 单个事件错误不终止监听
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        let _ = thread_app.emit("kb-fs-event", &pending);
                        pending.clear();
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    if let Some(state) = app.try_state::<WatchState>() {
        *state.0.lock().unwrap() = Some(watcher); // drop 旧 watcher = 自动停止
    }
    Ok(())
}

/// 打开知识库(5.0.3):校验可读并确保 .yanzhi 存在(旧库/裸 md 树可直开);随后挂文件监听
#[tauri::command]
pub fn open_kb(app: tauri::AppHandle, root: &str) -> Result<(), String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err("不是有效目录".into());
    }
    fs::read_dir(root_path).map_err(err)?;
    ensure_yanzhi(root_path)?;
    watch_kb(&app, root)?;
    Ok(())
}

#[tauri::command]
pub fn scan_tree(root: &str) -> Result<Vec<TreeNode>, String> {
    scan_dir(Path::new(root), Path::new(root))
}

#[tauri::command]
pub fn read_doc(root: &str, rel: &str) -> Result<String, String> {
    let abs = resolve(root, rel)?;
    // 非法 UTF-8(外部工具写入/磁盘损坏)用替换字符呈现:能打开、能保存;
    // 文件不存在仍走 Err(正常业务路径)
    let bytes = fs::read(&abs).map_err(err)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 自动保存落盘(5.2.5):临时文件 + 原子替换
#[tauri::command]
pub fn write_doc(root: &str, rel: &str, content: &str) -> Result<(), String> {
    let abs = resolve(root, rel)?;
    let tmp = abs.with_extension("md.tmp");
    fs::write(&tmp, content).map_err(err)?;
    fs::rename(&tmp, &abs).map_err(err)?;
    Ok(())
}

/* ---------------- 单文件模式(docs/single-file-mode.md) ---------------- */

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .map(|e| {
            let e = e.to_string_lossy().to_lowercase();
            e == "md" || e == "markdown"
        })
        .unwrap_or(false)
}

/// 选择一个 Markdown 文件;单文件模式只读入,不创建 .yanzhi
#[tauri::command]
pub async fn pick_single_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown"])
            .blocking_pick_file()
            .map(|f| f.to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_single_file(path: &str) -> Result<String, String> {
    let abs = Path::new(path);
    if !is_markdown_path(abs) {
        return Err("仅支持 Markdown 文件".into());
    }
    if !abs.is_file() {
        return Err("文件不存在或已被移动".into());
    }
    let bytes = fs::read(abs).map_err(err)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 用户显式保存:先确认原文件仍在,再同目录临时文件原子替换
#[tauri::command]
pub fn write_single_file(path: &str, content: &str) -> Result<(), String> {
    let abs = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "文件不存在或已被移动".to_string())?;
    if !is_markdown_path(&abs) {
        return Err("仅支持 Markdown 文件".into());
    }
    if !abs.is_file() {
        return Err("文件不存在或已被移动".into());
    }
    let tmp = PathBuf::from(format!("{}.tmp", abs.display()));
    fs::write(&tmp, content).map_err(err)?;
    fs::rename(&tmp, &abs).map_err(err)?;
    Ok(())
}

/// 另存为:系统保存框;目标已存在时自动追加 ` (2)`,不覆盖
#[tauri::command]
pub async fn save_single_file_as(
    app: tauri::AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(default_name)
            .add_filter("Markdown", &["md", "markdown"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let mut abs = PathBuf::from(picked.to_string());
    if abs.extension().is_none() {
        abs.set_extension("md");
    }
    if !is_markdown_path(&abs) {
        return Err("仅支持 Markdown 文件".into());
    }
    if let Some(parent) = abs.parent() {
        let title = abs
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = abs
            .extension()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "md".into());
        let mut candidate = abs.clone();
        let mut n = 2;
        while candidate.exists() {
            candidate = parent.join(format!("{title} ({n}).{ext}"));
            n += 1;
        }
        abs = candidate;
    }
    let tmp = PathBuf::from(format!("{}.tmp", abs.display()));
    fs::write(&tmp, content).map_err(err)?;
    fs::rename(&tmp, &abs).map_err(err)?;
    Ok(Some(abs.to_string_lossy().to_string()))
}

/// 监听文件所在目录(非递归):原子替换/删除/移动都能收到事件,只发射目标文件
#[tauri::command]
pub fn watch_single_file(app: tauri::AppHandle, path: &str) -> Result<(), String> {
    use notify::Watcher;
    let target = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "文件不存在或已被移动".to_string())?;
    if !is_markdown_path(&target) {
        return Err("仅支持 Markdown 文件".into());
    }
    let parent = target.parent().ok_or("无父目录")?.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx).map_err(err)?;
    watcher
        .watch(&parent, notify::RecursiveMode::NonRecursive)
        .map_err(err)?;

    let thread_app = app.clone();
    std::thread::spawn(move || {
        let mut pending = false;
        loop {
            match rx.recv_timeout(Duration::from_millis(FS_QUIET_MS)) {
                Ok(Ok(ev)) => {
                    if ev.paths.iter().any(|p| p == &target) {
                        pending = true;
                    }
                }
                Ok(Err(_)) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if pending {
                        let _ = thread_app
                            .emit("yz-single-file-event", target.to_string_lossy().to_string());
                        pending = false;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    if let Some(state) = app.try_state::<WatchState>() {
        *state.0.lock().unwrap() = Some(watcher);
    }
    Ok(())
}

/// 关闭单文件时停止监听
#[tauri::command]
pub fn close_single_file(app: tauri::AppHandle, _path: &str) {
    if let Some(state) = app.try_state::<WatchState>() {
        *state.0.lock().unwrap() = None;
    }
}

#[tauri::command]
pub fn create_doc(
    root: &str,
    folder_rel: &str,
    title: &str,
    content: Option<&str>,
) -> Result<String, String> {
    let dir = if folder_rel.is_empty() {
        PathBuf::from(root)
    } else {
        resolve(root, folder_rel)?
    };
    let title = sanitize_title(title);
    let filename = dedupe(&dir, &title, ".md", None);
    let abs = dir.join(&filename);
    // 无内容时正文为空:显示标题来自文件名(9.2);模板新建由前端传入变换后的正文
    fs::write(&abs, content.unwrap_or("")).map_err(err)?;
    Ok(rel_posix(Path::new(root), &abs))
}

#[tauri::command]
pub fn create_folder(root: &str, folder_rel: &str, name: &str) -> Result<String, String> {
    let dir = if folder_rel.is_empty() {
        PathBuf::from(root)
    } else {
        resolve(root, folder_rel)?
    };
    let name = sanitize_title(name);
    let final_name = dedupe(&dir, &name, "", None);
    let abs = dir.join(&final_name);
    fs::create_dir_all(&abs).map_err(err)?;
    Ok(rel_posix(Path::new(root), &abs))
}

/// 删除 = 移入 `.yanzhi/trash/` 并保留相对路径(5.1);trash 内同名追加 ` (n)`
#[tauri::command]
pub fn move_to_trash(root: &str, rel: &str) -> Result<String, String> {
    let abs = resolve(root, rel)?;
    if !abs.exists() {
        return Err("文件不存在".into());
    }
    let trash_root = Path::new(root).join(".yanzhi/trash");
    let target = trash_root.join(rel);
    let final_target = if target.exists() {
        let is_dir = abs.is_dir();
        let stem = rel.trim_end_matches(".md").trim_end_matches(".MD");
        let ext = if is_dir { "" } else { ".md" };
        dedupe(&target.parent().unwrap(), stem, ext, None)
    } else {
        rel.to_string()
    };
    let final_abs = trash_root.join(&final_target);
    fs::create_dir_all(final_abs.parent().unwrap()).map_err(err)?;
    fs::rename(&abs, &final_abs).map_err(err)?;
    Ok(final_target)
}

/// 重命名结果:new_path = 新相对路径;updated_files = 引用被联动改写的文档
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub new_path: String,
    pub updated_files: Vec<String>,
    pub ref_count: u64,
}

/// 临时文件 + 原子替换写回(write_doc 同策略)
fn write_atomic(abs: &Path, content: &str) -> Result<(), String> {
    let tmp = abs.with_extension("md.tmp");
    fs::write(&tmp, content).map_err(err)?;
    fs::rename(&tmp, abs).map_err(err)?;
    Ok(())
}

/// 收集库内全部文档绝对路径(跳过规则与 scan_dir 一致,另含 .yanzhi 之外的隐藏目录)
fn collect_docs(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let skip = name.starts_with('.') || name == "assets" || name == "node_modules";
        if skip {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            collect_docs(root, &entry.path(), out);
        } else if name.to_lowercase().ends_with(".md") {
            out.push(entry.path());
        }
    }
}

/// 全库联动更新 `[[双链]]` 引用(5.1 重命名/移动联动):
/// 文档改名 → 裸名/路径两种写法闭式替换;文件夹改名 → 仅在 `[[…]]` 区间内做段级替换,不误伤普通文本;
/// 文件夹移动 → 仅重写以 `旧路径/` 开头的 [[目标]] 前缀。返回(被改写文档的相对路径, 替换次数)。
fn update_wikilink_refs(
    root: &Path,
    patterns: &[(String, String)], // 文档闭式 pattern(含 `[[` 前缀),长键在前
    folder: Option<(&str, &str)>,  // 文件夹改名:(旧段, 新段)
    prefix: Option<(&str, &str)>,  // 文件夹移动:(旧路径前缀, 新路径前缀)
) -> Result<(Vec<String>, u64), String> {
    let mut docs = Vec::new();
    collect_docs(root, root, &mut docs);
    let mut updated = Vec::new();
    let mut count = 0u64;
    for abs in docs {
        let Ok(content) = fs::read_to_string(&abs) else {
            continue;
        };
        let mut next = content.clone();
        for (from, to) in patterns {
            count += next.matches(from.as_str()).count() as u64;
            next = next.replace(from.as_str(), to.as_str());
        }
        if let Some((old_seg, new_seg)) = folder {
            let (replaced, n) = replace_folder_segments(&next, old_seg, new_seg);
            count += n;
            next = replaced;
        }
        if let Some((old_p, new_p)) = prefix {
            let (replaced, n) = replace_link_prefixes(&next, old_p, new_p);
            count += n;
            next = replaced;
        }
        if next != content {
            write_atomic(&abs, &next)?;
            updated.push(rel_posix(root, &abs));
        }
    }
    Ok((updated, count))
}

/// 只在 `[[目标]]` / `[[目标|别名]]` 的目标路径段内替换文件夹名;
/// 普通文本中出现同名字符串不受影响(别名 `|` 之后也不动)。
fn replace_folder_segments(content: &str, old_seg: &str, new_seg: &str) -> (String, u64) {
    let mut out = String::with_capacity(content.len());
    let mut count = 0u64;
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        let after = start + 2;
        out.push_str(&rest[..after]);
        let tail = &rest[after..];
        let Some(end) = tail.find("]]") else {
            out.push_str(tail);
            rest = "";
            break;
        };
        let inner = &tail[..end];
        let (target, alias) = match inner.split_once('|') {
            Some((t, a)) => (t, Some(a)),
            None => (inner, None),
        };
        let mut hits = 0u64;
        let segs: Vec<&str> = target.split('/').collect();
        // 单段 target([[folder]])指向名为 folder 的文档,不是文件夹 → 不动;
        // 多段路径里的段命中文件夹名才替换
        let joined = if segs.len() > 1 {
            let mapped: Vec<&str> = segs
                .iter()
                .map(|&s| {
                    if s == old_seg {
                        hits += 1;
                        new_seg
                    } else {
                        s
                    }
                })
                .collect();
            mapped.join("/")
        } else {
            target.to_string()
        };
        count += hits;
        out.push_str(&joined);
        if let Some(a) = alias {
            out.push('|');
            out.push_str(a);
        }
        out.push_str("]]");
        rest = &tail[end + 2..];
    }
    out.push_str(rest);
    (out, count)
}

/// 移动文件夹(名字不变):仅重写 [[目标]] 中以 `旧路径/` 开头的目标前缀;
/// 段名替换会误伤别处的同名段,故移动走整前缀匹配。
fn replace_link_prefixes(content: &str, old_prefix: &str, new_prefix: &str) -> (String, u64) {
    let mut out = String::with_capacity(content.len());
    let mut count = 0u64;
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        let after = start + 2;
        out.push_str(&rest[..after]);
        let tail = &rest[after..];
        let Some(end) = tail.find("]]") else {
            out.push_str(tail);
            rest = "";
            break;
        };
        let inner = &tail[..end];
        let (target, alias) = match inner.split_once('|') {
            Some((t, a)) => (t, Some(a)),
            None => (inner, None),
        };
        let old_with_slash = format!("{old_prefix}/");
        if target.starts_with(&old_with_slash) {
            count += 1;
            out.push_str(new_prefix);
            out.push_str(&target[old_prefix.len()..]);
        } else {
            out.push_str(target);
        }
        if let Some(a) = alias {
            out.push('|');
            out.push_str(a);
        }
        out.push_str("]]");
        rest = &tail[end + 2..];
    }
    out.push_str(rest);
    (out, count)
}

/// 重命名(同目录):文件名与标题同步的不变量由前端维护(9.2);
/// 同时联动更新全库 `[[双链]]` 引用(5.1)。
#[tauri::command]
pub fn rename_entry(root: &str, rel: &str, new_title: &str) -> Result<RenameResult, String> {
    let abs = resolve(root, rel)?;
    let title = sanitize_title(new_title);
    let ext = if abs.is_dir() { "" } else { ".md" };
    let dir = abs.parent().ok_or("无父目录")?;
    let filename = dedupe(dir, &title, ext, Some(&abs));
    let new_abs = dir.join(&filename);
    fs::rename(&abs, &new_abs).map_err(err)?;
    let new_rel = rel_after_rename(rel, &filename);
    let root_path = Path::new(root);

    let mut patterns: Vec<(String, String)> = Vec::new();
    let mut folder: Option<(&str, &str)> = None;
    if abs.is_dir() {
        folder = Some((rel, new_rel.as_str()));
    } else {
        // 文档:路径写法优先(长键在前),再裸名;别名形式同步覆盖
        let old_stem = rel.trim_end_matches(".md");
        let new_stem = new_rel.trim_end_matches(".md");
        patterns.push((format!("[[{old_stem}]]"), format!("[[{new_stem}]]")));
        patterns.push((format!("[[{old_stem}|"), format!("[[{new_stem}|")));
        let old_name = old_stem.rsplit('/').next().unwrap_or(old_stem);
        let new_name = new_stem.rsplit('/').next().unwrap_or(new_stem);
        if old_name != old_stem {
            patterns.push((format!("[[{old_name}]]"), format!("[[{new_name}]]")));
            patterns.push((format!("[[{old_name}|"), format!("[[{new_name}|")));
        }
    }
    let (updated_files, ref_count) = update_wikilink_refs(root_path, &patterns, folder, None)?;
    // 快照目录跟随新路径(6.2:改名后历史面板仍可追溯)
    move_history_dir(root_path, rel, &new_rel);

    Ok(RenameResult {
        new_path: new_rel,
        updated_files,
        ref_count,
    })
}

/// 移动(改父目录,名字不变):目录树拖拽调整层级(5.1)。
/// 目标位置同名冲突报错;路径写法的 [[双链]] 联动改写(裸名不受影响)。
#[tauri::command]
pub fn move_entry(root: &str, src: &str, dest_folder: &str) -> Result<RenameResult, String> {
    let src_abs = resolve(root, src)?;
    if !src_abs.exists() {
        return Err(format!("不存在: {src}"));
    }
    let is_dir = src_abs.is_dir();
    let dest_abs = if dest_folder.is_empty() {
        PathBuf::from(root).canonicalize().map_err(err)? // 与 resolve 同底,保证 starts_with 可比
    } else {
        let d = resolve(root, dest_folder)?;
        if !d.is_dir() {
            return Err(format!("目标文件夹不存在: {dest_folder}"));
        }
        d
    };
    // 目标不能在源子树内(拖进自己/子孙)
    if dest_abs.starts_with(&src_abs) {
        return Err("不能移动到自身内部".into());
    }
    let name = src_abs.file_name().ok_or("非法路径")?.to_os_string();
    let new_abs = dest_abs.join(&name);
    if new_abs.exists() {
        return Err("目标位置已有同名条目".into());
    }
    if src_abs.parent() == Some(dest_abs.as_path()) {
        // 已在目标位置:幂等返回,不动盘也不改引用
        return Ok(RenameResult {
            new_path: src.to_string(),
            updated_files: vec![],
            ref_count: 0,
        });
    }
    // 文档移动前先计算 assets 迁移:目标文件夹 assets 按原文件名复制,
    // Markdown 引用改写为 ./assets/<name>;源 assets 保留供其它文档共用。
    let old_doc_dir = src_abs.parent().map(Path::to_path_buf);
    let new_doc_dir = new_abs.parent().map(Path::to_path_buf);
    let migrated_content = if !is_dir {
        match fs::read(&src_abs)
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
        {
            Some(content) if old_doc_dir.is_some() && new_doc_dir.is_some() => {
                let (next, changed) = migrate_doc_asset_refs(
                    Path::new(root),
                    &content,
                    old_doc_dir.as_deref().unwrap(),
                    new_doc_dir.as_deref().unwrap(),
                )?;
                Some((next, changed))
            }
            _ => None,
        }
    } else {
        None
    };
    fs::rename(&src_abs, &new_abs).map_err(err)?;
    let name_str = name.to_string_lossy();
    let new_rel = if dest_folder.is_empty() {
        name_str.to_string()
    } else {
        format!("{dest_folder}/{name_str}")
    };
    if let Some((content, changed)) = &migrated_content {
        if *changed {
            write_atomic(&new_abs, content)?;
        }
    }

    let mut patterns: Vec<(String, String)> = Vec::new();
    let mut prefix: Option<(&str, &str)> = None;
    if is_dir {
        prefix = Some((src, new_rel.as_str()));
    } else {
        // 文档:仅路径写法需要改写;根级文档路径写法即裸名,移动后裸名仍解析 → 不动
        let old_stem = src.trim_end_matches(".md");
        let new_stem = new_rel.trim_end_matches(".md");
        if old_stem.contains('/') {
            patterns.push((format!("[[{old_stem}]]"), format!("[[{new_stem}]]")));
            patterns.push((format!("[[{old_stem}|"), format!("[[{new_stem}|")));
        }
    }
    let (mut updated_files, ref_count) =
        update_wikilink_refs(Path::new(root), &patterns, None, prefix)?;
    if migrated_content
        .as_ref()
        .is_some_and(|(_, changed)| *changed)
        && !updated_files.contains(&new_rel)
    {
        updated_files.push(new_rel.clone());
    }
    // 快照目录随文件夹整体迁移(子孙文档的快照目录嵌套在内)
    move_history_dir(Path::new(root), src, &new_rel);

    Ok(RenameResult {
        new_path: new_rel,
        updated_files,
        ref_count,
    })
}

/// 移动单篇文档时迁移 assets:只处理随文档存在且位于某层 assets/ 的相对目标。
fn migrate_doc_asset_refs(
    root: &Path,
    content: &str,
    old_doc_dir: &Path,
    new_doc_dir: &Path,
) -> Result<(String, bool), String> {
    let root_canon = root.canonicalize().map_err(err)?;
    let dest_assets = new_doc_dir.join("assets");
    let mut out = String::with_capacity(content.len());
    let mut offset = 0;
    let mut changed = false;

    while let Some(found) = content[offset..].find("](") {
        let open = offset + found + 2;
        let mut start = open;
        while content[start..]
            .chars()
            .next()
            .is_some_and(char::is_whitespace)
        {
            start += content[start..].chars().next().unwrap().len_utf8();
        }
        let angle = content[start..].starts_with('<');
        let target_start = start + usize::from(angle);
        let target_end = if angle {
            content[target_start..]
                .find('>')
                .map(|i| target_start + i)
                .unwrap_or(target_start)
        } else {
            content[target_start..]
                .find(|c: char| c == ')' || c.is_whitespace())
                .map(|i| target_start + i)
                .unwrap_or(target_start)
        };
        if target_end <= target_start {
            out.push_str(&content[offset..start]);
            offset = start;
            continue;
        }
        let target = &content[target_start..target_end];
        let rewritten = (|| -> Option<String> {
            if target.is_empty()
                || target.contains("://")
                || target.starts_with("data:")
                || target.starts_with('#')
                || target.starts_with('/')
                || target.starts_with('\\')
            {
                return None;
            }
            let source = old_doc_dir.join(target).canonicalize().ok()?;
            if !source.starts_with(&root_canon)
                || !source.components().any(|c| c.as_os_str() == "assets")
                || !source.is_file()
            {
                return None;
            }
            fs::create_dir_all(&dest_assets).ok()?;
            let name = source.file_name()?.to_os_string();
            let dest = dest_assets.join(&name);
            if !dest.exists() {
                fs::copy(&source, &dest).ok()?;
            }
            Some(format!("./assets/{}", name.to_string_lossy()))
        })();
        out.push_str(&content[offset..target_start]);
        if let Some(next) = rewritten {
            changed |= next != target;
            out.push_str(&next);
        } else {
            out.push_str(target);
        }
        offset = target_end;
    }
    out.push_str(&content[offset..]);
    Ok((out, changed))
}

/// meta.json 按原文读写(前端管结构;写失败不阻塞文档保存,调用方容错)
#[tauri::command]
pub fn read_meta(root: &str) -> Result<String, String> {
    match fs::read_to_string(Path::new(root).join(".yanzhi/meta.json")) {
        Ok(s) => Ok(s),
        Err(_) => Ok(r#"{"version":1,"docs":{},"folders":{}}"#.to_string()),
    }
}

#[tauri::command]
pub fn write_meta(root: &str, content: &str) -> Result<(), String> {
    let abs = Path::new(root).join(".yanzhi/meta.json");
    let tmp = abs.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(err)?;
    fs::rename(&tmp, &abs).map_err(err)?;
    Ok(())
}

/// 最近打开列表(应用配置目录,非知识库内;PRD 2.1.3);last_doc = 上次打开的文档相对路径
#[derive(Serialize, Deserialize, Default)]
pub struct RecentState {
    pub last: Option<String>,
    pub recent: Vec<String>,
    #[serde(default)]
    pub last_doc: Option<String>,
}

fn recent_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("recent.json"))
}

pub fn read_recent(app: &tauri::AppHandle) -> RecentState {
    recent_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_recent(app: tauri::AppHandle) -> Result<RecentState, String> {
    Ok(read_recent(&app))
}

#[tauri::command]
pub fn set_recent(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let mut state = read_recent(&app);
    state.recent.retain(|r| r != &root);
    state.recent.insert(0, root.clone());
    state.recent.truncate(10);
    state.last = Some(root);
    let p = recent_path(&app)?;
    let json = serde_json::to_string_pretty(&state).map_err(err)?;
    fs::write(p, json).map_err(err)?;
    // 菜单「最近打开」跟 recent.json 同步(失败只丢菜单项,不影响打开链路)
    let _ = crate::build_app_menu(&app);
    Ok(())
}

/// 单文件模式最近记录:独立于知识库 recent,不参与启动自动恢复
#[derive(Serialize, Deserialize, Default)]
pub struct RecentFilesState {
    pub recent: Vec<String>,
}

fn recent_files_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("recent-files.json"))
}

pub fn read_recent_files(app: &tauri::AppHandle) -> RecentFilesState {
    recent_files_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_recent_files(_app: tauri::AppHandle) -> Result<RecentFilesState, String> {
    Ok(read_recent_files(&_app))
}

#[tauri::command]
pub fn set_recent_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut state = read_recent_files(&app);
    state.recent.retain(|p| p != &path);
    state.recent.insert(0, path);
    state.recent.truncate(10);
    let p = recent_files_path(&app)?;
    let json = serde_json::to_string_pretty(&state).map_err(err)?;
    fs::write(p, json).map_err(err)?;
    let _ = crate::build_app_menu(&app);
    Ok(())
}

/// 单文件转存知识库:文档复制到库根,引用的本地资源复制到根 assets;不移动/修改原文件
#[tauri::command]
pub fn save_single_to_kb(
    root: String,
    path: String,
    content: String,
    asset_srcs: Vec<String>,
) -> Result<String, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err("不是有效知识库目录".into());
    }
    ensure_yanzhi(root_path)?;
    let src = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "源文件不存在".to_string())?;
    if !is_markdown_path(&src) {
        return Err("仅支持 Markdown 文件".into());
    }
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let rel = dedupe(root_path, &sanitize_title(&stem), ".md", None);
    let assets_dir = root_path.join("assets");
    fs::create_dir_all(&assets_dir).map_err(err)?;
    for asset in asset_srcs {
        let Ok(from) = PathBuf::from(asset).canonicalize() else {
            continue;
        };
        if !from.is_file() {
            continue;
        }
        let Some(name) = from.file_name() else {
            continue;
        };
        let to = assets_dir.join(name);
        if !to.exists() {
            fs::copy(&from, &to).map_err(err)?;
        }
    }
    let target = root_path.join(&rel);
    let tmp = target.with_extension("md.tmp");
    fs::write(&tmp, content).map_err(err)?;
    fs::rename(&tmp, &target).map_err(err)?;
    Ok(rel)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SingleDraft {
    pub path: String,
    pub content: String,
    pub saved_at: u64,
}

fn single_draft_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("single-file-draft.json"))
}

#[tauri::command]
pub fn save_single_draft(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    let draft = SingleDraft {
        path,
        content,
        saved_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(err)?
            .as_millis() as u64,
    };
    let json = serde_json::to_string_pretty(&draft).map_err(err)?;
    fs::write(single_draft_path(&app)?, json).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn get_single_draft(app: tauri::AppHandle, path: &str) -> Result<Option<SingleDraft>, String> {
    let Some(raw) = fs::read_to_string(single_draft_path(&app)?).ok() else {
        return Ok(None);
    };
    let draft: SingleDraft = serde_json::from_str(&raw).map_err(err)?;
    Ok((draft.path == path).then_some(draft))
}

#[tauri::command]
pub fn clear_single_draft(app: tauri::AppHandle, path: &str) -> Result<(), String> {
    if get_single_draft(app.clone(), path)?.is_some() {
        let p = single_draft_path(&app)?;
        fs::remove_file(p).map_err(err)?;
    }
    Ok(())
}

/// 记住「上次打开的文档」(openDoc 时调用;只更新 last_doc,不动 recent 列表)
#[tauri::command]
pub fn set_last_doc(app: tauri::AppHandle, rel: String) -> Result<(), String> {
    let mut state = read_recent(&app);
    state.last_doc = Some(rel);
    let p = recent_path(&app)?;
    let json = serde_json::to_string_pretty(&state).map_err(err)?;
    fs::write(p, json).map_err(err)?;
    Ok(())
}

/* ---------------- 全局设置(8:应用配置目录,不进知识库 meta) ---------------- */

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("settings.json"))
}

/// 设置原文读取(前端管结构;缺失回 "{}" 由前端兜底默认值)
#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Result<String, String> {
    match fs::read_to_string(settings_path(&app)?) {
        Ok(s) => Ok(s),
        Err(_) => Ok("{}".to_string()),
    }
}

#[tauri::command]
pub fn set_settings(app: tauri::AppHandle, content: String) -> Result<(), String> {
    // 坏 JSON 不落盘(防前端异常状态污染配置)
    serde_json::from_str::<serde_json::Value>(&content).map_err(|_| "非法 JSON".to_string())?;
    fs::write(settings_path(&app)?, content).map_err(err)?;
    Ok(())
}

/* ---------------- 全库读取(搜索索引构建用,5.5) ---------------- */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocContent {
    pub path: String,
    pub content: String,
}

/// 一次 invoke 读全库文档(逐篇 read_doc 在千文档库上 IPC 往返太慢)
#[tauri::command]
pub fn read_all_docs(root: &str) -> Result<Vec<DocContent>, String> {
    let root_path = Path::new(root);
    let mut abs_docs = Vec::new();
    collect_docs(root_path, root_path, &mut abs_docs);
    let mut out = Vec::with_capacity(abs_docs.len());
    for abs in abs_docs {
        // 与 read_doc 同口径:非法 UTF-8 lossy 呈现,不静默跳过(否则索引悄悄缺一篇)
        if let Ok(bytes) = fs::read(&abs) {
            out.push(DocContent {
                path: rel_posix(root_path, &abs),
                content: String::from_utf8_lossy(&bytes).into_owned(),
            });
        }
    }
    Ok(out)
}

/// 回收站内全部 md(反向链接「已删除」灰态来源,5.4-2);path = 原相对路径
#[tauri::command]
pub fn read_all_trash_docs(root: &str) -> Result<Vec<DocContent>, String> {
    let root_path = Path::new(root);
    let trash = root_path.join(".yanzhi/trash");
    let mut abs_docs = Vec::new();
    if trash.exists() {
        collect_docs(root_path, &trash, &mut abs_docs);
    }
    let mut out = Vec::with_capacity(abs_docs.len());
    for abs in abs_docs {
        if let Ok(content) = fs::read_to_string(&abs) {
            let rel = rel_posix(root_path, &abs)
                .trim_start_matches(".yanzhi/trash/")
                .to_string();
            out.push(DocContent { path: rel, content });
        }
    }
    Ok(out)
}

/* ---------------- assets 落盘(9.3) ---------------- */

/// FNV-1a 64 内容哈希 → 完整 16 hex 命名(与前端 mock 同式)
fn fnv1a_hex(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    /// 正文里写入的引用(`./assets/<hash>.<ext>`,相对文档所在文件夹)
    pub src: String,
}

fn ext_sanitize(ext: &str) -> String {
    let e: String = ext
        .trim_start_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(5)
        .collect::<String>()
        .to_ascii_lowercase();
    if e.is_empty() { "png".to_string() } else { e }
}

/// 图片字节写进「文档所在文件夹/assets/」,内容哈希命名,同内容不重写(9.3.2/9.3.3)
fn save_asset_bytes(
    root: &str,
    doc_rel: &str,
    ext: &str,
    bytes: &[u8],
) -> Result<AssetInfo, String> {
    if doc_rel.is_empty() {
        return Err("未打开文档,无法定位 assets 目录".into());
    }
    let doc_abs = resolve(root, doc_rel)?;
    let folder = doc_abs.parent().ok_or("无父目录")?.to_path_buf();
    let assets = folder.join("assets");
    fs::create_dir_all(&assets).map_err(err)?;
    let name = format!("{}.{}", fnv1a_hex(bytes), ext_sanitize(ext));
    let abs = assets.join(&name);
    if !abs.exists() {
        let tmp = assets.join(format!("{name}.tmp"));
        fs::write(&tmp, bytes).map_err(err)?;
        fs::rename(&tmp, &abs).map_err(err)?;
    }
    Ok(AssetInfo {
        src: format!("./assets/{name}"),
    })
}

/// 粘贴/拖拽剪贴板图片落盘(5.3.7/5.7)
#[tauri::command]
pub fn save_asset(
    root: &str,
    doc_rel: &str,
    ext: &str,
    bytes: Vec<u8>,
) -> Result<AssetInfo, String> {
    save_asset_bytes(root, doc_rel, ext, &bytes)
}

/// 从本地路径导入图片/附件(斜杠菜单「图片/附件」的文件选择入口):读盘 → 哈希 → assets
#[tauri::command]
pub fn import_asset(root: &str, doc_rel: &str, src_abs: &str) -> Result<AssetInfo, String> {
    let bytes = fs::read(src_abs).map_err(|_| format!("无法读取文件: {src_abs}"))?;
    let ext = Path::new(src_abs)
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    save_asset_bytes(root, doc_rel, &ext, &bytes)
}

/// 系统打开(macOS `open` / Windows `start`):附件卡片与模板文件夹共用
fn spawn_open(abs: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(abs);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "", &abs.to_string_lossy()]);
        c
    };
    cmd.spawn().map_err(|e| format!("无法打开: {e}"))?;
    Ok(())
}

/// 系统打开库内文件(附件卡片点击,PRD 6.1.5);
/// 路径经 resolve 防逃逸(canonicalize 后须仍在库内)
#[tauri::command]
pub fn open_path(root: &str, rel: &str) -> Result<(), String> {
    let abs = resolve(root, rel)?;
    if !abs.is_file() {
        return Err(format!("文件不存在: {rel}"));
    }
    spawn_open(&abs)
}

/// 文档模板(PRD 7.5):列出 `.yanzhi/templates/` 下的 .md 文件名(去扩展名,名称序)。
/// 目录不存在 = 无模板,返回空列表而非错误(模板是可选项)
#[tauri::command]
pub fn list_templates(root: &str) -> Result<Vec<String>, String> {
    let dir = Path::new(root).join(".yanzhi/templates");
    let mut names: Vec<String> = match fs::read_dir(&dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map_or(false, |t| t.is_file()))
            .filter_map(|e| {
                let p = e.path();
                if p.extension().map_or(false, |x| x == "md") {
                    p.file_stem()?.to_str().map(str::to_string)
                } else {
                    None
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    names.sort();
    Ok(names)
}

/// 模板名限单段(无路径分隔与 ..,防逃逸)→ 模板文件绝对路径
fn template_path(root: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("非法模板名".to_string());
    }
    Ok(Path::new(root)
        .join(".yanzhi/templates")
        .join(format!("{name}.md")))
}

/// 读模板原文;非 UTF-8 lossy 呈现(与 read_doc 同口径)
#[tauri::command]
pub fn read_template(root: &str, name: &str) -> Result<String, String> {
    let abs = template_path(root, name)?;
    let bytes = fs::read(&abs).map_err(|_| format!("模板不存在: {name}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 写/新建模板(应用内模板管理,7.5);目录不存在则创建
#[tauri::command]
pub fn write_template(root: &str, name: &str, content: &str) -> Result<(), String> {
    let abs = template_path(root, name)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(&abs, content).map_err(err)
}

/// 删除模板(移入文件管理器可见的直接删除;模板不是正文,不进回收站)
#[tauri::command]
pub fn delete_template(root: &str, name: &str) -> Result<(), String> {
    let abs = template_path(root, name)?;
    fs::remove_file(&abs).map_err(|_| format!("模板不存在: {name}"))
}

/// 打开模板文件夹(不存在则创建):模板管理 = 直接在其中增删 .md 文件
#[tauri::command]
pub fn open_templates_dir(root: &str) -> Result<(), String> {
    let dir = Path::new(root).join(".yanzhi/templates");
    fs::create_dir_all(&dir).map_err(err)?;
    spawn_open(&dir)
}

/// Markdown 文件选择器(导入用,多选);取消返回 null
#[tauri::command]
pub async fn pick_docs(app: tauri::AppHandle) -> Result<Option<Vec<String>>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown", "txt"])
            .blocking_pick_files()
            .map(|fs| fs.iter().map(|f| f.to_string()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())
}

/// 图片文件选择器(多选);取消返回 null
#[tauri::command]
pub async fn pick_images(app: tauri::AppHandle) -> Result<Option<Vec<String>>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter(
                "图片",
                &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"],
            )
            .blocking_pick_files()
            .map(|fs| fs.iter().map(|f| f.to_string()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())
}

/// 任意类型文件选择器(附件卡片 6.1.5,多选,无过滤);取消返回 null
#[tauri::command]
pub async fn pick_files(app: tauri::AppHandle) -> Result<Option<Vec<String>>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_files()
            .map(|fs| fs.iter().map(|f| f.to_string()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())
}

/// 导出/离线 HTML 内联图片用:按库内相对路径读文件为 base64
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetData {
    pub data: String,
    pub mime: String,
}

#[tauri::command]
pub fn read_asset_base64(root: &str, rel: &str) -> Result<Option<AssetData>, String> {
    let Ok(abs) = resolve(root, rel) else {
        return Ok(None);
    };
    let Ok(bytes) = fs::read(&abs) else {
        return Ok(None);
    };
    let mime = match abs
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    };
    // base64 标准字母表手写(避免为导出引 base64 crate)
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut b64 = String::with_capacity(bytes.len() / 3 * 4 + 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        b64.push(TABLE[(n >> 18) as usize & 63] as char);
        b64.push(TABLE[(n >> 12) as usize & 63] as char);
        b64.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        b64.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    Ok(Some(AssetData {
        data: b64,
        mime: mime.to_string(),
    }))
}

fn collect_asset_files(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let ft = entry.file_type().map_err(err)?;
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            collect_asset_files(root, &entry.path(), out)?;
        } else if ft.is_file() {
            out.push(rel_posix(root, &entry.path()));
        }
    }
    Ok(())
}

/// V3 未引用资源清理:列出所有 `<folder>/assets/` 内的文件,不进入 .yanzhi。
#[tauri::command]
pub fn list_assets(root: &str) -> Result<Vec<String>, String> {
    let root_path = Path::new(root).canonicalize().map_err(err)?;
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(err)? {
            let entry = entry.map_err(err)?;
            let name = entry.file_name().to_string_lossy().to_string();
            let ft = entry.file_type().map_err(err)?;
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                if name.starts_with('.') || name == "node_modules" {
                    continue;
                }
                if name == "assets" {
                    collect_asset_files(root, &entry.path(), out)?;
                } else {
                    walk(root, &entry.path(), out)?;
                }
            }
        }
        Ok(())
    }
    walk(&root_path, &root_path, &mut out)?;
    out.sort();
    Ok(out)
}

/// 只删除经前端确认无人引用的 assets 文件;任何非 assets 路径直接拒绝。
#[tauri::command]
pub fn delete_assets(root: &str, rels: Vec<String>) -> Result<usize, String> {
    let root_path = Path::new(root).canonicalize().map_err(err)?;
    let mut removed = 0;
    for rel in rels {
        let abs = resolve(root, &rel)?;
        let under_assets = abs
            .strip_prefix(&root_path)
            .map_err(err)?
            .components()
            .any(|c| c.as_os_str() == "assets");
        if !under_assets || !abs.is_file() {
            return Err(format!("拒绝删除 assets 之外的路径: {rel}"));
        }
        fs::remove_file(abs).map_err(err)?;
        removed += 1;
    }
    Ok(removed)
}

/* ---------------- 回收站(5.1.1) ---------------- */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    /// 原相对路径(含 .md / 原文件夹层级)
    pub path: String,
    pub is_dir: bool,
    /// 文件夹内的文档数
    pub docs: u32,
}

fn count_md(dir: &Path) -> u32 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut n = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "assets" {
            continue;
        }
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            n += count_md(&entry.path());
        } else if name.to_lowercase().ends_with(".md") {
            n += 1;
        }
    }
    n
}

#[tauri::command]
pub fn list_trash(root: &str) -> Result<Vec<TrashEntry>, String> {
    let trash = Path::new(root).join(".yanzhi/trash");
    let mut out = Vec::new();
    let mut stack = vec![trash.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let rel = rel_posix(Path::new(root), &entry.path())
                .trim_start_matches(".yanzhi/trash/")
                .to_string();
            if is_dir {
                stack.push(entry.path());
            }
            out.push(TrashEntry {
                path: rel,
                is_dir,
                docs: if is_dir { count_md(&entry.path()) } else { 0 },
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// 恢复到原路径;冲突时按 strategy:overwrite 覆盖 / rename 追加 ` (n)`;
/// strategy=None 且冲突 → Err("CONFLICT"),前端弹三选一(5.1.1)
#[tauri::command]
pub fn restore_trash(root: &str, rel: &str, strategy: Option<String>) -> Result<String, String> {
    let trash_abs = Path::new(root)
        .join(".yanzhi/trash")
        .join(rel.trim_start_matches('/'));
    if !trash_abs.exists() {
        return Err("回收站中不存在该条目".into());
    }
    let (parent_rel, file_name) = match rel.rsplit_once('/') {
        Some((p, n)) => (p.to_string(), n.to_string()),
        None => (String::new(), rel.to_string()),
    };
    let target = resolve_new(root, rel)?;
    let mut final_rel = rel.to_string();
    if target.exists() {
        match strategy.as_deref() {
            Some("overwrite") => {
                if target.is_dir() {
                    fs::remove_dir_all(&target).map_err(err)?;
                } else {
                    fs::remove_file(&target).map_err(err)?;
                }
            }
            Some("rename") => {
                let ext = if trash_abs.is_dir() { "" } else { ".md" };
                let stem = file_name
                    .trim_end_matches(".md")
                    .trim_end_matches(".MD")
                    .to_string();
                let filename = dedupe(&target.parent().unwrap(), &stem, ext, None);
                final_rel = if parent_rel.is_empty() {
                    filename
                } else {
                    format!("{parent_rel}/{filename}")
                };
                let renamed = resolve_new(root, &final_rel)?;
                fs::create_dir_all(renamed.parent().unwrap()).map_err(err)?;
                fs::rename(&trash_abs, &renamed).map_err(err)?;
                // 原路径被占用改新名恢复:快照目录跟随(同名恢复则路径未变,无需迁移)
                move_history_dir(Path::new(root), rel, &final_rel);
                return Ok(final_rel);
            }
            _ => return Err("CONFLICT".into()),
        }
    }
    fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
    fs::rename(&trash_abs, &target).map_err(err)?;
    Ok(final_rel)
}

/// 彻底删除回收站单条(不可恢复;原 V3 项提前)
#[tauri::command]
pub fn purge_trash(root: &str, rel: &str) -> Result<(), String> {
    let rel = rel.trim_start_matches('/');
    // 不可恢复的破坏性操作,先挡路径逃逸
    if rel.is_empty()
        || rel
            .split('/')
            .any(|c| c == ".." || c == "." || c.is_empty())
    {
        return Err("非法路径".into());
    }
    let abs = Path::new(root).join(".yanzhi/trash").join(rel);
    if !abs.exists() {
        return Err("回收站中不存在该条目".into());
    }
    if abs.is_dir() {
        fs::remove_dir_all(&abs).map_err(err)?;
    } else {
        fs::remove_file(&abs).map_err(err)?;
    }
    // 彻底删除 = 连历史快照一起清(6.2;文件夹的子孙快照嵌套其下)
    remove_history_dir(Path::new(root), rel);
    Ok(())
}

/// 清空回收站(删 trash 根下全部条目,目录本身保留);对应快照目录一并清理
#[tauri::command]
pub fn empty_trash(root: &str) -> Result<(), String> {
    let trash = Path::new(root).join(".yanzhi/trash");
    let Ok(entries) = fs::read_dir(&trash) else {
        return Ok(());
    };
    let root_path = Path::new(root);
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let p = entry.path();
        let rel = rel_posix(root_path, &p)
            .trim_start_matches(".yanzhi/trash/")
            .to_string();
        if p.is_dir() {
            fs::remove_dir_all(&p).map_err(err)?;
        } else {
            fs::remove_file(&p).map_err(err)?;
        }
        remove_history_dir(root_path, &rel);
    }
    Ok(())
}

/* ---------------- 历史快照(6.2,.yanzhi/history) ---------------- */

/// 快照条目(前端直接渲染)。**索引即文件名**:`<unix_ms>-<a|m>-<fnv16>.md`,
/// 不设独立索引文件 → 列表与磁盘永不漂移(a=自动受节流,m=手动)。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// 快照文件名(读内容的唯一 id)
    pub id: String,
    /// 快照时间(unix 毫秒)
    pub time: u64,
    /// true = 自动快照,false = 手动「打快照」
    pub auto: bool,
    /// 字符数(面板展示「N 字」)
    pub chars: u32,
}

/// 文档相对路径 → 快照目录:去尾部 .md(`随笔/a.md` → `.yanzhi/history/随笔/a`);
/// 文件夹 rel 原样(其下文档的快照目录嵌套在内,一次 rename 即整体迁移)。
/// 段级校验挡 `..` 逃逸(purge_trash 同式)。
fn history_dir(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let trimmed = rel.trim_start_matches('/');
    let stem = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".MD"))
        .unwrap_or(trimmed);
    if stem
        .split('/')
        .any(|s| s.is_empty() || s == ".." || s == ".")
    {
        return Err(format!("非法路径: {rel}"));
    }
    Ok(root.join(".yanzhi/history").join(stem))
}

/// 解析快照文件名 → (时间 ms, 是否自动);不合法(临时文件/外部杂物)返回 None
fn parse_history_id(name: &str) -> Option<(u64, bool)> {
    let rest = name.strip_suffix(".md")?;
    let (time, rest) = rest.split_once('-')?;
    let (kind, hash) = rest.split_once('-')?;
    let auto = match kind {
        "a" => true,
        "m" => false,
        _ => return None,
    };
    if hash.len() != 16 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some((time.parse().ok()?, auto))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 时间倒序列出某文档的全部快照(目录不存在 = 空列表)
#[tauri::command]
pub fn list_history(root: &str, rel: &str) -> Result<Vec<HistoryEntry>, String> {
    let dir = history_dir(Path::new(root), rel)?;
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some((time, auto)) = parse_history_id(&name) {
                let chars = fs::read_to_string(entry.path())
                    .map(|s| s.chars().count() as u32)
                    .unwrap_or(0);
                out.push(HistoryEntry {
                    id: name,
                    time,
                    auto,
                    chars,
                });
            }
        }
    }
    out.sort_by(|a, b| b.time.cmp(&a.time).then(b.id.cmp(&a.id)));
    Ok(out)
}

/// 读快照内容(id 即文件名,先过 parse 校验防路径逃逸)
#[tauri::command]
pub fn read_history(root: &str, rel: &str, id: &str) -> Result<String, String> {
    if parse_history_id(id).is_none() {
        return Err(format!("非法快照 id: {id}"));
    }
    let abs = history_dir(Path::new(root), rel)?.join(id);
    let bytes = fs::read(&abs).map_err(|_| format!("快照不存在: {id}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 单目录按 keep 裁最旧快照;返回删除份数。杂物文件不计入、不删除。
fn prune_history_dir(dir: &Path, keep: usize) -> u32 {
    let keep = keep.max(1);
    let mut ids: Vec<(u64, String)> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some((time, _)) = parse_history_id(&name) {
                ids.push((time, name));
            }
        }
    }
    ids.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let mut removed = 0u32;
    for (_, name) in ids.iter().skip(keep) {
        if fs::remove_file(dir.join(name)).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// 递归遍历 `.yanzhi/history`:先下子目录,再裁当前目录内快照文件。
fn walk_prune_history(dir: &Path, keep: usize, removed: &mut u32) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk_prune_history(&path, keep, removed);
            }
        }
    }
    *removed += prune_history_dir(dir, keep);
}

/// 按当前 keep 立刻裁剪全库历史(6.2-5):设置调小上限 / 开库兜底时调用;
/// 目录缺失 = 0;返回删除的快照文件数。
#[tauri::command]
pub fn prune_history(root: &str, keep: u32) -> Result<u32, String> {
    let base = Path::new(root).join(".yanzhi/history");
    if !base.is_dir() {
        return Ok(0);
    }
    let mut removed = 0u32;
    walk_prune_history(&base, keep.max(1) as usize, &mut removed);
    Ok(removed)
}

/// 写入快照并自动清理(6.2-5):超出 keep 的最旧删除;keep 至少保留本次写入。
/// 节流(≥间隔 + 有实质差异)与手动入口都在前端,后端只管存储与上限。
#[tauri::command]
pub fn save_snapshot(
    root: &str,
    rel: &str,
    content: &str,
    auto: bool,
    keep: u32,
) -> Result<HistoryEntry, String> {
    let dir = history_dir(Path::new(root), rel)?;
    fs::create_dir_all(&dir).map_err(err)?;
    let time = now_ms();
    let id = format!(
        "{time}-{}-{}.md",
        if auto { "a" } else { "m" },
        fnv1a_hex(content.as_bytes())
    );
    write_atomic(&dir.join(&id), content)?;
    prune_history_dir(&dir, keep.max(1) as usize);
    Ok(HistoryEntry {
        id,
        time,
        auto,
        chars: content.chars().count() as u32,
    })
}

/// 改名/移动后迁移快照目录(文件夹的子孙快照嵌套其下,一次 rename 全带走);
/// 目标已存在(同名文档+文件夹并存)→ 逐文件合并(id 含时间+内容哈希,无覆盖风险)。
fn move_history_dir(root: &Path, old_rel: &str, new_rel: &str) {
    let (Ok(old), Ok(new)) = (history_dir(root, old_rel), history_dir(root, new_rel)) else {
        return;
    };
    if !old.is_dir() {
        return;
    }
    if new.is_dir() {
        if let Ok(entries) = fs::read_dir(&old) {
            for e in entries.flatten() {
                let _ = fs::rename(e.path(), new.join(e.file_name()));
            }
        }
        let _ = fs::remove_dir(&old);
    } else if let Some(parent) = new.parent() {
        let _ = fs::create_dir_all(parent);
        let _ = fs::rename(&old, &new);
    }
}

/// 彻底删除(purge/清空回收站)时同步清掉对应快照目录;best-effort
fn remove_history_dir(root: &Path, rel: &str) {
    if let Ok(dir) = history_dir(root, rel) {
        let _ = fs::remove_dir_all(dir);
    }
}

/* ---------------- 导入导出(5.6) ---------------- */

/// 单篇 md 的图片引用迁移:相对路径图片 → 目标文件夹 assets(哈希命名)→ 改写 `./assets/…`
fn migrate_md_assets(content: &str, src_dir: &Path, assets_dir: &Path) -> Result<String, String> {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(bang) = rest.find("![") {
        let alt_end = match rest[bang..].find("](") {
            Some(i) => bang + i,
            None => break,
        };
        let close = match rest[alt_end..].find(')') {
            Some(i) => alt_end + i,
            None => break,
        };
        let url = rest[alt_end + 2..close].trim();
        // 只迁相对路径本地文件;外链/data URI/锚点/绝对路径原样保留
        let skip = url.is_empty()
            || url.contains("://")
            || url.starts_with("data:")
            || url.starts_with('#')
            || url.starts_with('/')
            || url.starts_with('\\');
        if skip {
            out.push_str(&rest[..close + 1]);
            rest = &rest[close + 1..];
            continue;
        }
        // ./x.png → x.png;允许 ../ 穿越(按文件存在性兜底,不存在原样保留)
        let rel_ref = url.trim_start_matches("./");
        let src_abs = src_dir.join(rel_ref);
        if src_abs.exists() && src_abs.is_file() {
            fs::create_dir_all(assets_dir).map_err(err)?;
            let bytes = fs::read(&src_abs).map_err(err)?;
            let ext = src_abs
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            let name = format!("{}.{}", fnv1a_hex(&bytes), ext_sanitize(&ext));
            let dst = assets_dir.join(&name);
            if !dst.exists() {
                fs::copy(&src_abs, &dst).map_err(err)?;
            }
            out.push_str(&rest[..alt_end + 2]);
            out.push_str(&format!("./assets/{name}"));
            out.push(')');
        } else {
            out.push_str(&rest[..close + 1]);
        }
        rest = &rest[close + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// 导入外部 Markdown(5.6):文件落到目标文件夹(重名 ` (n)`),图片迁到 assets
#[tauri::command]
pub fn import_docs(
    root: &str,
    folder_rel: &str,
    src_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let dir = if folder_rel.is_empty() {
        PathBuf::from(root)
    } else {
        resolve(root, folder_rel)?
    };
    let assets_dir = dir.join("assets");
    let mut imported = Vec::new();
    for src in &src_paths {
        let src_path = Path::new(src);
        let Ok(raw) = fs::read_to_string(src_path) else {
            continue; // 单篇失败不阻断整批
        };
        let content = migrate_md_assets(
            &raw,
            src_path.parent().unwrap_or(Path::new(".")),
            &assets_dir,
        )?;
        let stem = src_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "未命名文档".into());
        let title = sanitize_title(&stem);
        let filename = dedupe(&dir, &title, ".md", None);
        let abs = dir.join(&filename);
        write_atomic(&abs, &content)?;
        imported.push(rel_posix(Path::new(root), &abs));
    }
    Ok(imported)
}

/// Markdown / 离线 HTML 导出:系统保存对话框选位置后写盘;取消返回 null
#[tauri::command]
pub async fn export_text(
    app: tauri::AppHandle,
    default_name: String,
    filter_ext: String,
    content: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let exts: Vec<String> = filter_ext
        .split(',')
        .map(|s| s.trim().to_string())
        .collect();
    let label: &'static str = if exts.first().map(|s| s.as_str()) == Some("html") {
        "HTML"
    } else {
        "Markdown"
    };
    let name = default_name;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let ext_refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        app.dialog()
            .file()
            .set_file_name(name)
            .add_filter(label, &ext_refs)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.to_string();
    fs::write(&path, content).map_err(err)?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// M4 异常恢复:非法 UTF-8 的 md 不报错,替换字符呈现(能打开能存)
    #[test]
    fn read_doc_lossy_on_invalid_utf8() {
        let dir = std::env::temp_dir().join(format!("yz-read-doc-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("bad.md"), [0x61, 0xFF, 0x62]).unwrap(); // a<invalid>b
        let root = dir.to_string_lossy().to_string();
        let content = read_doc(&root, "bad.md").unwrap();
        assert!(content.starts_with('a') && content.ends_with('b'));
        assert!(
            content.contains('\u{FFFD}'),
            "非法字节应以替换字符呈现: {content:?}"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 7.5 模板:目录缺失 = 空列表;列出 .md(去扩展名,忽略非 md);名字防逃逸
    #[test]
    fn templates_list_read_and_traversal() {
        let dir = std::env::temp_dir().join(format!("yz-tpl-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".yanzhi/templates")).unwrap();
        std::fs::write(dir.join(".yanzhi/templates/b.md"), "# b\n").unwrap();
        std::fs::write(dir.join(".yanzhi/templates/a.md"), "# a\n").unwrap();
        std::fs::write(dir.join(".yanzhi/templates/note.txt"), "not md").unwrap();
        let root = dir.to_string_lossy().to_string();

        let names = list_templates(&root).unwrap();
        assert_eq!(
            names,
            vec!["a".to_string(), "b".to_string()],
            "名称序,非 md 不列: {names:?}"
        );
        assert_eq!(read_template(&root, "a").unwrap(), "# a\n");
        assert!(
            read_template(&root, "../meta").is_err(),
            "路径段模板名须拒绝"
        );
        assert!(
            list_templates(&format!(
                "{}/不存在目录-{}",
                std::env::temp_dir().to_string_lossy(),
                std::process::id()
            ))
            .unwrap()
            .is_empty(),
            "模板目录缺失 = 空列表而非错误"
        );
        // 写(目录缺失时连建)/ 读 / 改名另存(写新名 + 删旧)/ 删
        let empty_root = dir
            .parent()
            .unwrap()
            .join(format!("yz-tpl-empty-{}", std::process::id()));
        write_template(&empty_root.to_string_lossy(), "新建", "# 新\n\n骨架\n").unwrap();
        assert_eq!(
            read_template(&empty_root.to_string_lossy(), "新建").unwrap(),
            "# 新\n\n骨架\n"
        );
        write_template(&root, "c", "# c\n").unwrap();
        delete_template(&root, "b").unwrap();
        assert!(delete_template(&root, "b").is_err(), "已删再删应报错");
        assert_eq!(
            list_templates(&root).unwrap(),
            vec!["a".to_string(), "c".to_string()]
        );
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::remove_dir_all(&empty_root).unwrap();
    }

    fn hist_test_root(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("yz-hist-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().to_string()
    }

    /// 6.2:快照写入 → 列表时间倒序 → 超出 keep 自动清最旧
    #[test]
    fn snapshot_list_and_trim() {
        let root = hist_test_root("trim");
        for i in 0..4 {
            save_snapshot(&root, "随笔/a.md", &format!("v{i}"), true, 3).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2)); // id 时间段不撞
        }
        let list = list_history(&root, "随笔/a.md").unwrap();
        assert_eq!(list.len(), 3, "keep=3 应只剩 3 份: {list:?}");
        // 倒序 + 内容对上(最旧 v0 被清,最新是 v3)
        let newest = read_history(&root, "随笔/a.md", &list[0].id).unwrap();
        assert_eq!(newest, "v3");
        let oldest = read_history(&root, "随笔/a.md", &list[2].id).unwrap();
        assert_eq!(oldest, "v1");
        assert!(list.iter().all(|e| e.auto));
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// 调小 keep 立刻全库裁剪(不必等下次写入);多文档各自独立上限
    #[test]
    fn prune_history_trims_immediately() {
        let root = hist_test_root("prune");
        for i in 0..5 {
            save_snapshot(&root, "随笔/a.md", &format!("a{i}"), true, 10).unwrap();
            save_snapshot(&root, "b.md", &format!("b{i}"), false, 10).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        assert_eq!(list_history(&root, "随笔/a.md").unwrap().len(), 5);
        assert_eq!(list_history(&root, "b.md").unwrap().len(), 5);
        let removed = prune_history(&root, 2).unwrap();
        assert_eq!(removed, 6, "两篇各删 3 份: {removed}");
        let a = list_history(&root, "随笔/a.md").unwrap();
        let b = list_history(&root, "b.md").unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(b.len(), 2);
        assert_eq!(read_history(&root, "随笔/a.md", &a[0].id).unwrap(), "a4");
        assert_eq!(read_history(&root, "b.md", &b[1].id).unwrap(), "b3");
        assert_eq!(prune_history(&root, 2).unwrap(), 0, "已合规再裁为零");
        // keep=0 与设置钳制同口径 → 至少留 1,两篇各再删 1
        assert_eq!(prune_history(&root, 0).unwrap(), 2);
        assert_eq!(list_history(&root, "随笔/a.md").unwrap().len(), 1);
        assert_eq!(prune_history(&root, 1).unwrap(), 0);
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// 非法 id / 越界路径拒绝(快照文件名同时是路径拼接入参)
    #[test]
    fn history_rejects_bad_id_and_traversal() {
        let root = hist_test_root("guard");
        assert!(
            read_history(&root, "a.md", "../x.md").is_err(),
            "id 必须过文件名校验"
        );
        assert!(
            read_history(&root, "a.md", "1730000000000-a-deadbeef.md").is_err(),
            "不存在的快照报错"
        );
        assert!(list_history(&root, "../escape.md").is_err(), "rel 越界拒绝");
        assert!(save_snapshot(&root, "a/../b.md", "x", true, 5).is_err());
        // 合法名但哈希段长度不对 → 不识别(列表忽略、读取拒绝)
        std::fs::create_dir_all(std::path::Path::new(&root).join(".yanzhi/history/a")).unwrap();
        std::fs::write(
            std::path::Path::new(&root).join(".yanzhi/history/a/1-a-abc.md"),
            "junk",
        )
        .unwrap();
        assert!(
            list_history(&root, "a.md").unwrap().is_empty(),
            "杂物文件不入列表"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// 改名迁移:文档/文件夹改名后快照目录跟随(6.2 与 5.1 联动)
    #[test]
    fn history_moves_with_rename() {
        let root = hist_test_root("move");
        save_snapshot(&root, "随笔/a.md", "hello", false, 5).unwrap();
        let root_path = std::path::Path::new(&root);
        move_history_dir(root_path, "随笔/a.md", "随笔/b.md");
        let list = list_history(&root, "随笔/b.md").unwrap();
        assert_eq!(list.len(), 1, "快照应已迁到新名: {list:?}");
        assert!(list_history(&root, "随笔/a.md").unwrap().is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// 9.3.4:移动文档时复制引用的 assets,并把上层目录引用改成目标文件夹相对路径
    #[test]
    fn move_doc_migrates_referenced_assets() {
        let root = std::env::temp_dir().join(format!("yz-move-assets-{}", std::process::id()));
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::create_dir_all(root.join("旧")).unwrap();
        std::fs::create_dir_all(root.join("新")).unwrap();
        std::fs::write(root.join("assets/a.png"), b"png").unwrap();
        std::fs::write(root.join("旧/文档.md"), "![图](../assets/a.png)").unwrap();
        let root_s = root.to_string_lossy().to_string();
        move_entry(&root_s, "旧/文档.md", "新").unwrap();
        assert!(!root.join("旧/文档.md").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("新/文档.md")).unwrap(),
            "![图](./assets/a.png)"
        );
        assert_eq!(std::fs::read(root.join("新/assets/a.png")).unwrap(), b"png");
        assert!(
            root.join("assets/a.png").exists(),
            "源资源保留供其它文档使用"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }
}
