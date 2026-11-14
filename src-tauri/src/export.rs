//! DOCX 语义导出(PRD 5.6):前端传 Pandoc JSON AST,Rust 只负责调用外部 Pandoc。
//! 不接受 filter/template/任意命令行参数;外链图片由本模块受控下载成临时本地资源。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Manager;
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
    if Command::new("pandoc")
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
    let output = Command::new(path)
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

fn run_pandoc(
    pandoc: &Path,
    ast: &Value,
    output: &Path,
    resource_path: Option<&str>,
    reference_doc: Option<&Path>,
    highlight_theme: Option<&Path>,
    modern_highlight_flag: bool,
) -> Result<String, String> {
    let mut command = Command::new(pandoc);
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
        if Command::new("pandoc")
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
