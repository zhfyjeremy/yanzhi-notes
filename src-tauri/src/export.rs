//! 语义导出(PRD 5.6):DOCX 前端传 Pandoc JSON AST 后调用外部 Pandoc;PDF 复用隐藏 WebView。
//! 不接受 filter/template/任意命令行参数;外链图片由本模块受控下载成临时本地资源。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, WebviewUrl,
    webview::{PageLoadEvent, WebviewBuilder},
};
use tauri_plugin_dialog::DialogExt;
use url::Url;

const MAX_REDIRECTS: usize = 5;
const REMOTE_IMAGE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REMOTE_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_REMOTE_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxExportRequest {
    pub output_path: String,
    pub ast: Value,
    pub resource_path: Option<String>,
    pub remote_images: Vec<String>,
    pub download_remote_images: bool,
    pub pandoc_path: Option<String>,
    pub reference_doc_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxExportResult {
    pub path: String,
    pub warnings: Vec<String>,
    pub remote_embedded: usize,
    pub remote_failed: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// pandoc.exe 是控制台程序。从无控制台的 GUI 进程拉起时，Windows 会临时分配一个 cmd 黑窗。
fn pandoc_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn configured_pandoc(path: Option<&str>) -> PathBuf {
    let configured = path.unwrap_or_default().trim();
    if !configured.is_empty() {
        return PathBuf::from(configured);
    }
    PathBuf::from("pandoc")
}

fn find_pandoc(configured: Option<&str>) -> PathBuf {
    let explicit = configured_pandoc(configured);
    if explicit.as_os_str() != "pandoc" {
        return explicit;
    }
    if pandoc_command("pandoc")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
    {
        return PathBuf::from("pandoc");
    }
    let candidates = [
        "/opt/homebrew/bin/pandoc",
        "/usr/local/bin/pandoc",
        "/usr/bin/pandoc",
        r"C:\Program Files\Pandoc\pandoc.exe",
    ];
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from("pandoc"))
}

fn pandoc_major(version: &str) -> u32 {
    version
        .split_whitespace()
        .find(|s| s.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .and_then(|s| s.split('.').next())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn run_pandoc_version(path: &Path) -> Result<String, String> {
    let output = pandoc_command(path)
        .arg("--version")
        .output()
        .map_err(|e| format!("无法启动 Pandoc:{e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Pandoc 返回错误码 {}",
            output.status.code().unwrap_or(-1)
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .next()
        .map(str::to_string)
        .ok_or_else(|| "Pandoc 未返回版本信息".to_string())
}

#[tauri::command]
pub async fn detect_pandoc(pandoc_path: Option<String>) -> Result<PandocStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = find_pandoc(pandoc_path.as_deref());
        match run_pandoc_version(&path) {
            Ok(version) => {
                let major = pandoc_major(&version);
                if major < 3 {
                    return Ok(PandocStatus {
                        installed: false,
                        path: Some(path.to_string_lossy().into_owned()),
                        version: Some(version),
                        error: Some("砚知 DOCX 导出需要 Pandoc 3 或更新版本".into()),
                    });
                }
                Ok(PandocStatus {
                    installed: true,
                    path: Some(path.to_string_lossy().into_owned()),
                    version: Some(version),
                    error: None,
                })
            }
            Err(err) => Ok(PandocStatus {
                installed: false,
                path: None,
                version: None,
                error: Some(err),
            }),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pick_docx_output_path(
    app: AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    save_docx_dialog(app, default_name)
        .await
        .map(|path| path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn pick_export_path(app: AppHandle, kind: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        if kind == "reference-docx" {
            dialog
                .add_filter("Word 模板", &["docx"])
                .blocking_pick_file()
                .map(|p| p.to_string())
        } else {
            dialog.blocking_pick_file().map(|p| p.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())
}

fn locate_export_resource(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("resources").join(name));
        candidates.push(dir.join(name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join(name));
            candidates.push(dir.join(name));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name),
    );
    candidates.into_iter().find(|p| p.is_file())
}

async fn save_docx_dialog(app: AppHandle, default_name: String) -> Result<Option<PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(default_name)
            .add_filter("Word 文档", &["docx"])
            .blocking_save_file()
            .map(|f| PathBuf::from(f.to_string()))
    })
    .await
    .map_err(|e| e.to_string())
}

fn ip_is_private(ip: IpAddr) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => IpAddr::V6(v6),
        },
        v4 => v4,
    };
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_multicast()
        }
        IpAddr::V6(v6) => {
            let s = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xff00) == 0xfe80 // IPv6 link-local
                || (s[0] & 0xfe00) == 0xfc00 // IPv6 unique-local
        }
    }
}

fn validate_public_url(raw: &str) -> Result<(Url, SocketAddr), String> {
    let url = Url::parse(raw).map_err(|_| "图片 URL 无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("仅支持 http/https 图片".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("图片 URL 不允许携带凭据".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "图片 URL 缺少主机".to_string())?;
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
    {
        return Err("不允许访问本机或本地域名图片".into());
    }
    let port = url.port_or_known_default().unwrap_or(80);
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|_| "图片域名无法解析".to_string())?
        .collect::<Vec<_>>();
    if addrs.is_empty() {
        return Err("图片域名没有可用地址".into());
    }
    if addrs.iter().any(|addr| ip_is_private(addr.ip())) {
        return Err("不允许访问内网图片".into());
    }
    let pinned = *addrs
        .iter()
        .find(|addr| !ip_is_private(addr.ip()))
        .ok_or_else(|| "图片域名没有可用公网地址".to_string())?;
    Ok((url, pinned))
}

fn client_for_url(url: &Url, pinned: SocketAddr) -> Result<reqwest::Client, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "图片 URL 缺少主机".to_string())?;
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REMOTE_IMAGE_TIMEOUT)
        // 强制直连已校验 IP,避免系统代理转发导致 SSRF 校验失效。
        .no_proxy()
        .resolve(host, pinned)
        .build()
        .map_err(|e| format!("初始化图片下载失败:{e}"))
}

fn extension_for_content_type(content_type: &str) -> Option<&'static str> {
    let primary = content_type.split(';').next()?.trim().to_ascii_lowercase();
    match primary.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" => Some("bmp"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

fn fnv1a(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in data {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

async fn download_remote_image(
    raw_url: &str,
    directory: &Path,
    remaining_total: u64,
) -> Result<(PathBuf, u64), String> {
    let (mut current, mut pinned) = validate_public_url(raw_url)?;
    let mut redirects = 0;
    loop {
        let client = client_for_url(&current, pinned)?;
        let response = client
            .get(current.clone())
            .header("user-agent", "Yanzhi-Notes/DOCX-Export")
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "图片下载超时".into()
                } else {
                    format!("图片下载失败:{e}")
                }
            })?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "图片重定向缺少地址".to_string())?;
            let next = current
                .join(location)
                .map_err(|_| "图片重定向地址无效".to_string())?;
            redirects += 1;
            if redirects > MAX_REDIRECTS {
                return Err("图片重定向次数过多".into());
            }
            let (next_url, next_pinned) = validate_public_url(next.as_str())?;
            current = next_url;
            pinned = next_pinned;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("图片服务器返回 {}", response.status().as_u16()));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let extension = extension_for_content_type(&content_type)
            .ok_or_else(|| format!("图片类型不受支持:{content_type}"))?;
        if let Some(len) = response.content_length() {
            if len > MAX_REMOTE_IMAGE_BYTES {
                return Err("图片超过单张 25MB 限制".into());
            }
            if len > remaining_total {
                return Err("图片总量超过 100MB 限制".into());
            }
        }
        let bytes = response.bytes().await.map_err(|e| {
            if e.is_timeout() {
                "图片下载超时".into()
            } else {
                format!("图片下载失败:{e}")
            }
        })?;
        if bytes.len() as u64 > MAX_REMOTE_IMAGE_BYTES {
            return Err("图片超过单张 25MB 限制".into());
        }
        if bytes.len() as u64 > remaining_total {
            return Err("图片总量超过 100MB 限制".into());
        }
        let name = format!("{:016x}.{extension}", fnv1a(raw_url.as_bytes()));
        let path = directory.join(name);
        tokio::fs::write(&path, &bytes)
            .await
            .map_err(|e| format!("写入图片缓存失败:{e}"))?;
        return Ok((path, bytes.len() as u64));
    }
}

fn replace_remote_images(
    value: &mut Value,
    replacements: &std::collections::HashMap<String, String>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                replace_remote_images(item, replacements);
            }
        }
        Value::Object(map) => {
            for (_key, item) in map.iter_mut() {
                replace_remote_images(item, replacements);
            }
            if map.get("t").and_then(Value::as_str) == Some("Image") {
                let target = map
                    .get_mut("c")
                    .and_then(Value::as_array_mut)
                    .and_then(|c| c.get_mut(2))
                    .and_then(Value::as_array_mut)
                    .and_then(|target| target.first_mut())
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
                if let Some(url) = target {
                    if let Some(local) = replacements.get(&url) {
                        if let Some(target) = map
                            .get_mut("c")
                            .and_then(Value::as_array_mut)
                            .and_then(|c| c.get_mut(2))
                            .and_then(Value::as_array_mut)
                            .and_then(|target| target.first_mut())
                        {
                            *target = Value::String(local.clone());
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// rfd 的异步保存面板在 Tauri async command + macOS 主事件循环组合下可能挂起；
/// 导出路径这种强模态操作直接用 NSSavePanel 的应用模态窗口，行为更可控。
#[cfg(target_os = "macos")]
pub(crate) fn pick_macos_save_path(
    app: &AppHandle,
    default_name: String,
    extensions: &[&str],
) -> Result<Option<String>, String> {
    use objc2_app_kit::{NSApplication, NSModalResponseOK, NSSavePanel};
    use objc2_foundation::MainThreadMarker;
    use objc2_foundation::{NSMutableArray, NSString};

    let extensions: Vec<String> = extensions.iter().map(|ext| ext.to_string()).collect();
    let (tx, rx) = mpsc::channel::<Result<Option<String>, String>>();
    app.run_on_main_thread(move || {
        let result = (|| {
            let Some(mtm) = MainThreadMarker::new() else {
                return Err("无法访问 macOS 主线程".to_string());
            };
            {
                let app = NSApplication::sharedApplication(mtm);
                #[allow(deprecated)]
                app.activateIgnoringOtherApps(true);
                let panel = NSSavePanel::savePanel(mtm);
                panel.center();
                panel.setNameFieldStringValue(&NSString::from_str(&default_name));
                if !extensions.is_empty() {
                    let types = NSMutableArray::<NSString>::array();
                    for ext in extensions {
                        let value = NSString::from_str(&ext);
                        types.addObject(&value);
                    }
                    #[allow(deprecated)]
                    panel.setAllowedFileTypes(Some(&types));
                }
                panel.orderFrontRegardless();
                if panel.runModal() == NSModalResponseOK {
                    panel
                        .URL()
                        .and_then(|url| url.path())
                        .map(|path| path.to_string())
                        .map(Some)
                        .ok_or_else(|| "未获取保存路径".to_string())
                } else {
                    Ok(None)
                }
            }
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| format!("打开保存对话框失败:{e}"))?;

    rx.recv()
        .unwrap_or_else(|_| Err("保存对话框已中断".to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportRequest {
    pub output_path: String,
    pub html: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportResult {
    pub path: String,
}

#[tauri::command]
pub async fn pick_pdf_output_path(
    app: AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        pick_macos_save_path(&app, default_name, &["pdf"])
    }
    #[cfg(not(target_os = "macos"))]
    {
        tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .file()
                .set_file_name(default_name)
                .add_filter("PDF 文档", &["pdf"])
                .blocking_save_file()
                .map(|path| path.to_string())
        })
        .await
        .map_err(|e| e.to_string())
    }
}

fn close_export_webview(app: &AppHandle, label: &str) {
    if let Some(webview) = app.get_webview(label) {
        let _ = webview.close();
    }
}

#[cfg(windows)]
fn print_webview_to_pdf(
    webview: tauri::webview::PlatformWebview,
    output: PathBuf,
    result_tx: mpsc::Sender<Result<(), String>>,
) {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT, ICoreWebView2_7, ICoreWebView2Environment6,
        },
        PrintToPdfCompletedHandler,
    };
    use windows_core::{HSTRING, Interface, PCWSTR};

    unsafe {
        let result = (|| -> windows_core::Result<()> {
            let core = webview.controller().CoreWebView2()?;
            let core = core.cast::<ICoreWebView2_7>()?;
            let environment = webview.environment().cast::<ICoreWebView2Environment6>()?;
            let settings = environment.CreatePrintSettings()?;
            settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
            settings.SetScaleFactor(1.0)?;
            // A4,单位英寸;页面内边距交给导出 HTML 的 @page,避免双重页边距。
            settings.SetPageWidth(8.27)?;
            settings.SetPageHeight(11.69)?;
            settings.SetMarginTop(0.0)?;
            settings.SetMarginBottom(0.0)?;
            settings.SetMarginLeft(0.0)?;
            settings.SetMarginRight(0.0)?;
            settings.SetShouldPrintBackgrounds(true)?;
            settings.SetShouldPrintSelectionOnly(false)?;
            settings.SetShouldPrintHeaderAndFooter(false)?;

            let callback_tx = result_tx.clone();
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |hr, succeeded| {
                let result = if let Err(err) = hr {
                    Err(format!("WebView2 生成 PDF 失败:{err}"))
                } else if succeeded {
                    Ok(())
                } else {
                    Err("WebView2 生成 PDF 失败".into())
                };
                let _ = callback_tx.send(result);
                Ok(())
            }));
            let path = HSTRING::from(output.as_os_str());
            core.PrintToPdf(PCWSTR::from_raw(path.as_ptr()), &settings, &handler)?;
            Ok(())
        })();

        if let Err(err) = result {
            let _ = result_tx.send(Err(format!("WebView2 打印失败:{err}")));
        }
    }
}

/// WKWebView createPDF 生成的是“网页连续画布”PDF(macOS 会按 200in 分块),
/// 不是 A4 打印页。这里保持矢量内容,重绘为 A4 页并补 16mm 页边距,
/// 与 Windows PrintToPdf / 导出 HTML 的 @page 设置一致。
#[cfg(target_os = "macos")]
fn paginate_macos_pdf(data: &objc2_foundation::NSData) -> Result<Vec<u8>, String> {
    use std::ptr::NonNull;

    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_core_graphics::{
        CGContext, CGDataConsumer, CGDataProvider, CGPDFBox, CGPDFContextBeginPage,
        CGPDFContextClose, CGPDFContextCreate, CGPDFContextEndPage, CGPDFDocument,
    };

    const A4_WIDTH: f64 = 595.2755905511812;
    const A4_HEIGHT: f64 = 841.8897637795277;
    // 16mm,与 src/kb/export-html.ts 的 @page margin 保持一致。
    const PAGE_MARGIN: f64 = 45.35433070866142;

    let length = usize::try_from(data.length()).map_err(|_| "PDF 数据过大".to_string())?;
    let mut source_bytes = vec![0_u8; length];
    if length > 0 {
        unsafe {
            data.getBytes_length(
                NonNull::from(source_bytes.as_mut_slice()).cast(),
                data.length(),
            );
        }
    }

    unsafe {
        let source_data = objc2_core_foundation::CFData::new(
            None,
            source_bytes.as_ptr(),
            isize::try_from(length).map_err(|_| "PDF 数据过大".to_string())?,
        )
        .ok_or_else(|| "创建 PDF 源数据失败".to_string())?;
        let provider = CGDataProvider::with_cf_data(Some(&source_data))
            .ok_or_else(|| "初始化 PDF 渲染器失败".to_string())?;
        let source = CGPDFDocument::with_provider(Some(&provider))
            .ok_or_else(|| "读取 WKWebView PDF 失败".to_string())?;

        let output_data = objc2_core_foundation::CFMutableData::new(None, 0)
            .ok_or_else(|| "创建 PDF 输出缓冲失败".to_string())?;
        let consumer = CGDataConsumer::with_cf_data(Some(&output_data))
            .ok_or_else(|| "创建 PDF 输出器失败".to_string())?;
        let a4 = CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: A4_WIDTH,
                height: A4_HEIGHT,
            },
        };
        let context = CGPDFContextCreate(Some(&consumer), &a4, None)
            .ok_or_else(|| "创建 A4 PDF 上下文失败".to_string())?;
        let page_count = CGPDFDocument::number_of_pages(Some(&source));
        if page_count == 0 {
            return Err("WKWebView 未生成 PDF 页面".into());
        }

        // WKWebView 会把长网页按约 200in 拆成多个连续 PDF page。
        // A4 分页边界不一定落在这些 chunk 边界上,不能在每个 chunk 内独立从顶部重切;
        // 必须先把 chunk 还原成一条连续画布,再按全局 A4 边界取切片。
        let source_pages: Vec<_> = (1..=page_count)
            .map(|page_number| {
                let page = CGPDFDocument::page(Some(&source), page_number)
                    .ok_or_else(|| "读取 WKWebView PDF 页面失败".to_string())?;
                let rect =
                    objc2_core_graphics::CGPDFPage::box_rect(Some(&page), CGPDFBox::MediaBox);
                if rect.size.width <= 0.0 || rect.size.height <= 0.0 {
                    return Err("WKWebView PDF 页面尺寸无效".into());
                }
                Ok((page, rect))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let source_width = source_pages[0].1.size.width;
        if source_pages
            .iter()
            .any(|(_, rect)| (rect.size.width - source_width).abs() > 0.01)
        {
            return Err("WKWebView PDF 页面宽度不一致".into());
        }

        let scale = (A4_WIDTH - PAGE_MARGIN * 2.0) / source_width;
        let source_slice_height = (A4_HEIGHT - PAGE_MARGIN * 2.0) / scale;
        let total_source_height: f64 = source_pages.iter().map(|(_, rect)| rect.size.height).sum();
        let mut chunk_starts = Vec::with_capacity(source_pages.len());
        let mut chunk_start = 0.0_f64;
        for (_, rect) in &source_pages {
            chunk_starts.push(chunk_start);
            chunk_start += rect.size.height;
        }

        let mut target_start = 0.0_f64;
        while target_start < total_source_height {
            let target_end = (target_start + source_slice_height).min(total_source_height);
            CGPDFContextBeginPage(Some(&context), None);
            CGContext::set_rgb_fill_color(Some(&context), 1.0, 1.0, 1.0, 1.0);
            CGContext::fill_rect(Some(&context), a4);

            for (page_index, (page, source_rect)) in source_pages.iter().enumerate() {
                let chunk_start = chunk_starts[page_index];
                let chunk_end = chunk_start + source_rect.size.height;
                let overlap_start = target_start.max(chunk_start);
                let overlap_end = target_end.min(chunk_end);
                if overlap_start >= overlap_end {
                    continue;
                }

                // local_top/local_bottom 是相对当前 chunk 顶部的网页坐标;
                // PDF 坐标自下而上,所以要转换成源页 box 的 y offset。
                let local_top = overlap_start - chunk_start;
                let local_bottom = overlap_end - chunk_start;
                let offset = source_rect.size.height - local_bottom;
                let target_offset = overlap_start - target_start;
                CGContext::save_g_state(Some(&context));
                CGContext::translate_ctm(Some(&context), PAGE_MARGIN, PAGE_MARGIN);
                CGContext::scale_ctm(Some(&context), scale, scale);
                CGContext::translate_ctm(
                    Some(&context),
                    0.0,
                    source_slice_height - target_offset - source_rect.size.height + local_top,
                );
                CGContext::clip_to_rect(
                    Some(&context),
                    CGRect {
                        origin: CGPoint {
                            x: source_rect.origin.x,
                            y: source_rect.origin.y + offset,
                        },
                        size: CGSize {
                            width: source_rect.size.width,
                            height: local_bottom - local_top,
                        },
                    },
                );
                CGContext::draw_pdf_page(Some(&context), Some(page));
                CGContext::restore_g_state(Some(&context));
            }
            CGPDFContextEndPage(Some(&context));
            target_start = target_end;
        }
        CGPDFContextClose(Some(&context));
        drop(context);

        let length =
            usize::try_from(output_data.length()).map_err(|_| "PDF 输出过大".to_string())?;
        if length == 0 {
            return Err("A4 PDF 输出为空".into());
        }
        let bytes = output_data.byte_ptr();
        if bytes.is_null() {
            return Err("读取 A4 PDF 输出失败".into());
        }
        Ok(std::slice::from_raw_parts(bytes, length).to_vec())
    }
}

#[cfg(target_os = "macos")]
fn print_webview_to_pdf(
    webview: tauri::webview::PlatformWebview,
    output: PathBuf,
    result_tx: mpsc::Sender<Result<(), String>>,
) {
    use block2::RcBlock;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::WKWebView;

    unsafe {
        let view: &WKWebView = &*webview.inner().cast();
        let callback = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            let result = if data.is_null() {
                let message = if error.is_null() {
                    "WKWebView 未返回 PDF 数据".to_string()
                } else {
                    format!(
                        "WKWebView 生成 PDF 失败:{}",
                        (*error).localizedDescription()
                    )
                };
                Err(message)
            } else {
                match paginate_macos_pdf(&*data) {
                    Ok(pdf) => {
                        std::fs::write(&output, pdf).map_err(|e| format!("写入 PDF 文件失败:{e}"))
                    }
                    Err(e) => Err(e),
                }
            };
            let _ = result_tx.send(result);
        });
        view.createPDFWithConfiguration_completionHandler(None, &callback);
    }
}

#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    request: PdfExportRequest,
) -> Result<PdfExportResult, String> {
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, request);
        return Err("当前平台不支持 WebView PDF 导出".into());
    }

    #[cfg(any(windows, target_os = "macos"))]
    {
        let output = PathBuf::from(request.output_path.trim());
        if output.as_os_str().is_empty() {
            return Err("未选择 PDF 保存位置".into());
        }

        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("无法定位应用缓存目录:{e}"))?
            .join("pdf-export");
        tokio::fs::create_dir_all(&cache_dir)
            .await
            .map_err(|e| format!("创建 PDF 导出缓存目录失败:{e}"))?;
        let unique = format!(
            "{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            std::process::id()
        );
        let html_path = cache_dir.join(format!("{unique}.html"));
        let label = format!("yz-pdf-export-{unique}");
        tokio::fs::write(&html_path, request.html)
            .await
            .map_err(|e| format!("写入 PDF 导出临时 HTML 失败:{e}"))?;

        let output_display = output.clone();
        let result: Result<(), String> = async {
            let source = Url::from_file_path(&html_path)
                .map_err(|()| "无法定位 PDF 导出临时 HTML".to_string())?;
            let (load_tx, load_rx) = mpsc::channel::<Result<(), String>>();

            let main_window = app
                .get_window("main")
                .ok_or_else(|| "主窗口不可用,无法创建导出视图".to_string())?;
            let builder = WebviewBuilder::new(&label, WebviewUrl::CustomProtocol(source))
                .on_page_load(move |_webview, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        let _ = load_tx.send(Ok(()));
                    }
                });
            // 仅改 macOS:WKWebView 需要 disable inactive scheduling。
            #[cfg(target_os = "macos")]
            let builder = builder.background_throttling(BackgroundThrottlingPolicy::Disabled);

            #[cfg(target_os = "macos")]
            let (export_width, export_height) = (794.0, 1123.0);
            #[cfg(not(target_os = "macos"))]
            let (export_width, export_height) = (900.0, 1200.0);
            // 不创建任何 OS 窗口:导出 WebView 是主窗口的子视图,
            // 放到父窗口边界外并立即 hide,避免内容闪现/抢占焦点。
            let export_webview = main_window
                .add_child(
                    builder,
                    LogicalPosition::new(-10_000.0, -10_000.0),
                    LogicalSize::new(export_width, export_height),
                )
                .map_err(|e| format!("创建隐藏导出 WebView 失败:{e}"))?;
            // WKWebView 被隐藏后可能停止布局/渲染;屏外已足够避免闪现。
            #[cfg(windows)]
            let _ = export_webview.hide();

            // PageLoadFinished 已等待 HTML 与内嵌资源;再等两帧给字体解码/布局留余量。
            tokio::time::timeout(
                Duration::from_secs(30),
                tauri::async_runtime::spawn_blocking(move || {
                    load_rx
                        .recv()
                        .unwrap_or_else(|_| Err("隐藏导出视图加载中断".into()))
                }),
            )
            .await
            .map_err(|_| "隐藏导出视图加载超时".to_string())?
            .map_err(|e| format!("PDF 导出任务失败:{e}"))??;
            // createPDF 捕获的是屏幕媒体布局,不会自动启用 @media print。
            // 该覆盖只属于 macOS 的连续画布转 A4 管线;Windows PrintToPdf 继续走原生 @media print。
            #[cfg(target_os = "macos")]
            {
                export_webview
                    .eval(
                        r#"(() => {
                          const style = document.createElement('style');
                          style.id = 'yanzhi-pdf-print-layout';
                          style.textContent = 'html,body{background:#fff !important}body{max-width:none !important;width:794px !important;padding:0 !important}pre{white-space:pre-wrap !important;overflow:visible !important}table{width:100% !important;table-layout:fixed !important}[data-yz-pdf-page-break]{display:block !important;height:0;margin:0 !important;padding:0 !important;background:transparent !important}';
                          document.head.append(style);

                          // 与 Rust paginate_macos_pdf 的 794px 源画布 -> A4 内容区换算保持一致。
                          const PAGE_HEIGHT = 1182.0786516853934;
                          const selector = [
                            'h1,h2,h3,h4,h5,h6', 'p', 'li', 'dt', 'dd', 'blockquote',
                            'pre', 'table', 'img', 'figure', '.yz-callout', '.yz-details',
                            '.yz-math-block', '.yz-mmd-stage', '.yz-raw-html-preview', '.yz-attachment'
                          ].join(',');
                          const hasAtomicAncestor = (el) => {
                            for (let parent = el.parentElement; parent; parent = parent.parentElement) {
                              if (parent.matches(selector)) return true;
                            }
                            return false;
                          };
                          const atoms = [...document.querySelectorAll(selector)].filter((el) => {
                            const style = getComputedStyle(el);
                            return style.display !== 'none' && style.visibility !== 'hidden' && !hasAtomicAncestor(el);
                          });

                          // createPDF 使用屏幕连续画布,不会执行 @media print 的分页算法。
                          // 在每个 A4 边界前,把将要被切开且高度不超过一页的原子块推到下一页。
                          for (const el of atoms) {
                            const rect = el.getBoundingClientRect();
                            const top = rect.top + window.scrollY;
                            const bottom = rect.bottom + window.scrollY;
                            const boundary = Math.ceil((top + 0.01) / PAGE_HEIGHT) * PAGE_HEIGHT;
                            if (bottom <= boundary + 0.01 || top >= boundary || bottom - top > PAGE_HEIGHT) continue;

                            const spacer = document.createElement('div');
                            spacer.dataset.yzPdfPageBreak = '';
                            spacer.style.height = `${Math.max(0, boundary - top)}px`;
                            el.parentNode?.insertBefore(spacer, el);
                            let nextTop = el.getBoundingClientRect().top + window.scrollY;
                            spacer.style.height = `${Math.max(0, Number.parseFloat(spacer.style.height) + boundary - nextTop)}px`;
                          }
                        })()"#,
                    )
                    .map_err(|e| format!("切换 PDF 打印布局失败:{e}"))?;
            }

            tokio::time::sleep(std::time::Duration::from_millis(80)).await;

            let (print_tx, print_rx) = mpsc::channel::<Result<(), String>>();
            export_webview
                .with_webview(move |webview| {
                    print_webview_to_pdf(webview, output.clone(), print_tx)
                })
                .map_err(|e| format!("调用原生 PDF 引擎失败:{e}"))?;
            let print_result: Result<(), String> = {
                // 仅 macOS 的 createPDF + A4 重绘可能耗时较长;Windows 保持原有无限等待回调语义。
                #[cfg(target_os = "macos")]
                {
                    tokio::time::timeout(
                        Duration::from_secs(60),
                        tauri::async_runtime::spawn_blocking(move || {
                            print_rx
                                .recv()
                                .unwrap_or_else(|_| Err("原生 PDF 引擎无响应".into()))
                        }),
                    )
                    .await
                    .map_err(|_| "PDF 生成超时".to_string())?
                    .map_err(|e| format!("PDF 生成任务失败:{e}"))?
                }
                #[cfg(not(target_os = "macos"))]
                {
                    tauri::async_runtime::spawn_blocking(move || {
                        print_rx
                            .recv()
                            .unwrap_or_else(|_| Err("原生 PDF 引擎无响应".into()))
                    })
                    .await
                    .map_err(|e| format!("PDF 生成任务失败:{e}"))?
                }
            };
            print_result?;
            Ok(())
        }
        .await;

        close_export_webview(&app, &label);
        let _ = tokio::fs::remove_file(&html_path).await;
        result?;
        Ok(PdfExportResult {
            path: output_display.to_string_lossy().into_owned(),
        })
    }
}

fn run_pandoc(
    pandoc: &Path,
    ast: &Value,
    output: &Path,
    resource_path: Option<&str>,
    reference_doc: Option<&Path>,
    highlight_theme: Option<&Path>,
    modern_highlight_flag: bool,
) -> Result<String, String> {
    let mut command = pandoc_command(pandoc);
    command
        .arg("--from")
        .arg("json")
        .arg("--to")
        .arg("docx")
        .arg("--output")
        .arg(output);
    if let Some(path) = reference_doc {
        command.arg("--reference-doc").arg(path);
    }
    if let Some(path) = highlight_theme {
        command
            .arg(if modern_highlight_flag {
                "--syntax-highlighting"
            } else {
                "--highlight-style"
            })
            .arg(path);
    }
    if let Some(path) = resource_path {
        command.arg("--resource-path").arg(path);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let input = serde_json::to_vec(ast).map_err(|e| format!("序列化 Pandoc AST 失败:{e}"))?;
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动 Pandoc:{e}"))?;
    let Some(mut stdin) = child.stdin.take() else {
        return Err("无法打开 Pandoc 输入管道".into());
    };
    // wait_with_output 负责持续读取 stdout/stderr;写 stdin 放独立线程,避免大文档 warnings 填满管道后死锁。
    let (write_tx, write_rx) = mpsc::channel::<Result<(), String>>();
    let writer = std::thread::spawn(move || {
        let result = stdin
            .write_all(&input)
            .map_err(|e| format!("写入 Pandoc AST 失败:{e}"));
        drop(stdin);
        let _ = write_tx.send(result);
    });
    let output_result = child
        .wait_with_output()
        .map_err(|e| format!("等待 Pandoc 失败:{e}"));
    let write_result = write_rx
        .recv()
        .unwrap_or_else(|_| Err("Pandoc 输入线程异常退出".into()));
    let _ = writer.join();
    let output_result = output_result?;
    write_result?;
    let stderr = String::from_utf8_lossy(&output_result.stderr).into_owned();
    if !output_result.status.success() {
        let message = if stderr.trim().is_empty() {
            format!(
                "Pandoc 返回错误码 {}",
                output_result.status.code().unwrap_or(-1)
            )
        } else {
            stderr
        };
        return Err(message);
    }
    Ok(stderr)
}

#[tauri::command]
pub async fn export_docx(
    app: AppHandle,
    request: DocxExportRequest,
) -> Result<DocxExportResult, String> {
    let pandoc = find_pandoc(request.pandoc_path.as_deref());
    let version = run_pandoc_version(&pandoc)?;
    if pandoc_major(&version) < 3 {
        return Err("砚知 DOCX 导出需要 Pandoc 3 或更新版本".into());
    }

    let target = PathBuf::from(request.output_path.trim());
    if target.as_os_str().is_empty() {
        return Err("未选择 DOCX 保存位置".into());
    }

    let mut warnings: Vec<String> = Vec::new();
    let mut remote_embedded = 0;
    let mut remote_failed = 0;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法定位应用缓存目录:{e}"))?
        .join("docx-export");
    let unique = format!(
        "{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        std::process::id()
    );
    let download_dir = cache_dir.join(unique);
    let mut ast = request.ast;

    if !request.remote_images.is_empty() {
        if request.download_remote_images {
            tokio::fs::create_dir_all(&download_dir)
                .await
                .map_err(|e| format!("创建图片缓存目录失败:{e}"))?;
            let mut replacements = std::collections::HashMap::new();
            let mut total = 0u64;
            for url in &request.remote_images {
                match download_remote_image(url, &download_dir, MAX_REMOTE_TOTAL_BYTES - total)
                    .await
                {
                    Ok((path, size)) => {
                        total += size;
                        remote_embedded += 1;
                        replacements.insert(url.clone(), path.to_string_lossy().into_owned());
                    }
                    Err(err) => {
                        remote_failed += 1;
                        warnings.push(format!("外链图片未嵌入:{url}({err})"));
                    }
                }
            }
            replace_remote_images(&mut ast, &replacements);
            // 下载失败的目标仍保持 Image;统一降级成 Link,避免 Pandoc 访问网络。
            downgrade_failed_images(&mut ast, &request.remote_images, &replacements);
        }
    }

    let reference_doc = request
        .reference_doc_path
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| locate_export_resource(&app, "yanzhi-reference.docx"));
    if let Some(path) = &reference_doc {
        if !path.is_file() {
            return Err(format!("Word 模板不存在:{}", path.display()));
        }
    }
    let highlight_theme = locate_export_resource(&app, "yanzhi-highlight.theme");
    let version_parts: Vec<u32> = version
        .split_whitespace()
        .nth(1)
        .map(|v| v.split('.').filter_map(|n| n.parse().ok()).collect())
        .unwrap_or_default();
    let modern_highlight_flag = version_parts.first().is_some_and(|major| *major > 3)
        || (version_parts.first() == Some(&3)
            && version_parts.get(1).is_some_and(|minor| *minor >= 10));
    let temp_output = target.with_extension("docx.yanzhi-tmp");
    let pandoc_for_job = pandoc.clone();
    let ast_for_job = ast.clone();
    let resource_for_job = request.resource_path.clone();
    let temp_output_for_job = temp_output.clone();
    let reference_for_job = reference_doc.clone();
    let theme_for_job = highlight_theme.clone();
    let pandoc_result = tauri::async_runtime::spawn_blocking(move || {
        run_pandoc(
            &pandoc_for_job,
            &ast_for_job,
            &temp_output_for_job,
            resource_for_job.as_deref(),
            reference_for_job.as_deref(),
            theme_for_job.as_deref(),
            modern_highlight_flag,
        )
    })
    .await
    .map_err(|e| format!("Pandoc 任务启动失败:{e}"))?;

    match pandoc_result {
        Ok(stderr) => {
            if !stderr.trim().is_empty() {
                warnings.push(format!("Pandoc 提示:{stderr}"));
            }
            if target.exists() {
                std::fs::remove_file(&target).map_err(|e| format!("替换既有 DOCX 失败:{e}"))?;
            }
            std::fs::rename(&temp_output, &target).map_err(|e| format!("写入 DOCX 失败:{e}"))?;
            let _ = tokio::fs::remove_dir_all(&download_dir).await;
            Ok(DocxExportResult {
                path: target.to_string_lossy().into_owned(),
                warnings,
                remote_embedded,
                remote_failed,
            })
        }
        Err(err) => {
            let _ = tokio::fs::remove_file(&temp_output).await;
            let _ = tokio::fs::remove_dir_all(&download_dir).await;
            Err(err)
        }
    }
}

fn downgrade_failed_images(
    value: &mut Value,
    urls: &[String],
    replacements: &std::collections::HashMap<String, String>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                downgrade_failed_images(item, urls, replacements);
            }
        }
        Value::Object(map) => {
            for (_key, item) in map.iter_mut() {
                downgrade_failed_images(item, urls, replacements);
            }
            if map.get("t").and_then(Value::as_str) == Some("Image") {
                let target = map
                    .get("c")
                    .and_then(|c| c.get(2))
                    .and_then(|c| c.get(0))
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
                if let Some(url) = target {
                    if urls.contains(&url) && !replacements.contains_key(&url) {
                        map.insert("t".into(), Value::String("Link".into()));
                    }
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_image_urls_block_local_and_private_targets() {
        for url in [
            "http://127.0.0.1/a.png",
            "http://localhost/a.png",
            "http://192.168.1.1/a.png",
            "http://10.0.0.1/a.png",
            "http://172.16.0.1/a.png",
            "http://169.254.169.254/a.png",
            "http://[::1]/a.png",
            "http://example.com@a.example.com/a.png",
            "file:///tmp/a.png",
        ] {
            assert!(validate_public_url(url).is_err(), "{url} should be blocked");
        }
    }

    #[test]
    fn remote_image_content_types_map_to_extensions() {
        assert_eq!(extension_for_content_type("image/png"), Some("png"));
        assert_eq!(
            extension_for_content_type("image/svg+xml; charset=utf-8"),
            Some("svg")
        );
        assert_eq!(extension_for_content_type("text/html"), None);
    }
    #[test]
    fn pandoc_ast_remote_images_replace_and_downgrade() {
        let mut ast = serde_json::json!({
            "pandoc-api-version": [1, 23, 1, 2],
            "meta": {},
            "blocks": [{
                "t": "Para",
                "c": [{
                    "t": "Image",
                    "c": [
                        ["", [], []],
                        [{"t": "Str", "c": "图"}],
                        ["https://example.com/a.png", ""]
                    ]
                }]
            }]
        });
        let mut replacements = std::collections::HashMap::new();
        replacements.insert(
            "https://example.com/a.png".to_string(),
            "/cache/a.png".to_string(),
        );
        replace_remote_images(&mut ast, &replacements);
        assert_eq!(
            ast["blocks"][0]["c"][0]["c"][2][0],
            serde_json::json!("/cache/a.png")
        );

        let mut failed = serde_json::json!({
            "t": "Image",
            "c": [
                ["", [], []],
                [],
                ["https://example.com/b.png", ""]
            ]
        });
        downgrade_failed_images(
            &mut failed,
            &["https://example.com/b.png".to_string()],
            &replacements,
        );
        assert_eq!(failed["t"], serde_json::json!("Link"));
    }

    #[test]
    fn run_pandoc_writes_docx_with_builtin_styles() {
        if pandoc_command("pandoc")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_err()
        {
            return;
        }
        let ast = serde_json::json!({
            "pandoc-api-version": [1, 23, 1, 2],
            "meta": {},
            "blocks": [{"t": "Para", "c": [{"t": "Str", "c": "DOCX"}]}]
        });
        let output = std::env::temp_dir().join(format!("yanzhi-docx-{}.docx", std::process::id()));
        run_pandoc(
            Path::new("pandoc"),
            &ast,
            &output,
            None,
            Some(Path::new("resources/yanzhi-reference.docx")),
            Some(Path::new("resources/yanzhi-highlight.theme")),
            true,
        )
        .expect("pandoc should write docx");
        let bytes = std::fs::read(&output).expect("docx should exist");
        assert_eq!(&bytes[..2], b"PK");
        let _ = std::fs::remove_file(&output);
    }
}
