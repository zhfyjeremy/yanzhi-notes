//! AI 助手 BYOK(PRD §7.8):Key 进系统钥匙串;请求直达用户 Base URL;可取消。
//! 无砚知中转。允许 http://127.0.0.1 对接本地 Ollama。

use keyring::Entry;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use url::Url;

const SERVICE: &str = "com.yanzhi.notes";
const ACCOUNT: &str = "ai-api-key";
/// 本机 Key 缓存:进程内优先,持久层为系统钥匙串 + App Data 0600 备份。
/// 备份只用于钥匙串异常/开发环境重编译后恢复,不进知识库、不导出、不上传。
static AI_KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);

fn key_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(".ai-key"))
        .map_err(|e| format!("无法定位本机 Key 缓存: {e}"))
}

fn write_key_cache(app: &AppHandle, key: &str) -> Result<(), String> {
    let path = key_cache_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建本机 Key 缓存目录失败: {e}"))?;
    }
    std::fs::write(&path, key).map_err(|e| format!("写入本机 Key 缓存失败: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("设置本机 Key 缓存权限失败: {e}"))?;
    }
    Ok(())
}

fn read_key_cache(app: &AppHandle) -> Result<Option<String>, String> {
    let path = key_cache_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(key) => Ok(Some(key)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取本机 Key 缓存失败: {e}")),
    }
}

fn remove_key_cache(app: &AppHandle) -> Result<(), String> {
    let path = key_cache_path(app)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("清除本机 Key 缓存失败: {e}")),
    }
}

/// 进行中请求的取消通道(request_id → oneshot)
pub struct AiCancelMap(pub Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>);

impl Default for AiCancelMap {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

fn key_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("钥匙串不可用: {e}"))
}

#[tauri::command]
pub fn set_ai_key(key: String, app: AppHandle) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return clear_ai_key(app);
    }

    let keyring_result = key_entry().and_then(|entry| {
        entry
            .set_password(key)
            .map_err(|e| format!("写入系统钥匙串失败: {e}"))
    });
    let cache_result = write_key_cache(&app, key);
    if keyring_result.is_err() && cache_result.is_err() {
        return Err(format!(
            "{keyring_err:?};{cache_err:?}",
            keyring_err = keyring_result.unwrap_err(),
            cache_err = cache_result.unwrap_err(),
        ));
    }
    *AI_KEY_CACHE.lock().unwrap() = Some(key.to_string());
    Ok(())
}

#[tauri::command]
pub fn clear_ai_key(app: AppHandle) -> Result<(), String> {
    *AI_KEY_CACHE.lock().unwrap() = None;
    let keyring_result = match key_entry().and_then(|entry| {
        entry
            .delete_credential()
            .map_err(|e| format!("清除系统钥匙串失败: {e}"))
    }) {
        Ok(()) => Ok(()),
        Err(e) if e.contains("NoEntry") => Ok(()),
        Err(e) => Err(e),
    };
    let cache_result = remove_key_cache(&app);
    if keyring_result.is_err() && cache_result.is_err() {
        // 两者都不存在时视为已清除;此处仅在真实清除失败时返回。
        return Err(format!(
            "{keyring_err:?};{cache_err:?}",
            keyring_err = keyring_result.unwrap_err(),
            cache_err = cache_result.unwrap_err(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn has_ai_key(app: AppHandle) -> Result<bool, String> {
    if AI_KEY_CACHE
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|key| !key.trim().is_empty())
    {
        return Ok(true);
    }
    if let Ok(Some(key)) = read_key_cache(&app) {
        if !key.trim().is_empty() {
            *AI_KEY_CACHE.lock().unwrap() = Some(key);
            return Ok(true);
        }
    }
    match key_entry()?.get_password() {
        Ok(p) => {
            let has = !p.trim().is_empty();
            if has {
                *AI_KEY_CACHE.lock().unwrap() = Some(p);
            }
            Ok(has)
        }
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Ok(false),
    }
}

fn read_key(app: &AppHandle) -> Result<String, String> {
    if let Some(key) = AI_KEY_CACHE.lock().unwrap().as_ref() {
        if !key.trim().is_empty() {
            return Ok(key.clone());
        }
    }
    if let Ok(Some(key)) = read_key_cache(app) {
        if !key.trim().is_empty() {
            *AI_KEY_CACHE.lock().unwrap() = Some(key.clone());
            return Ok(key);
        }
    }
    match key_entry()?.get_password() {
        Ok(p) if !p.trim().is_empty() => {
            *AI_KEY_CACHE.lock().unwrap() = Some(p.clone());
            Ok(p)
        }
        Ok(_) | Err(keyring::Error::NoEntry) => Err("未配置 API Key".into()),
        Err(_) => read_key_cache(app)?
            .filter(|key| !key.trim().is_empty())
            .ok_or_else(|| "未配置 API Key".to_string()),
    }
}

fn normalize_base(base: &str) -> Result<String, String> {
    let raw = base.trim().trim_end_matches('/');
    if raw.is_empty() {
        return Err("请填写 API Base URL".into());
    }
    let u = Url::parse(raw).map_err(|_| "API Base URL 无效".to_string())?;
    match u.scheme() {
        "https" => {}
        "http" => {
            let host = u.host_str().unwrap_or("");
            if host != "127.0.0.1" && host != "localhost" {
                return Err("仅允许 https,或本机 http://127.0.0.1 / localhost".into());
            }
        }
        _ => return Err("仅支持 http(s)".into()),
    }
    Ok(raw.to_string())
}

fn chat_url(base: &str) -> String {
    let b = base.trim_end_matches('/');
    if is_anthropic_base(b) {
        return format!("{b}/v1/messages");
    }
    if b.ends_with("/chat/completions") {
        return b.to_string();
    }
    // /v1、智谱 /v4 等版本后缀 → 直接拼 chat/completions
    if let Some(i) = b.rfind("/v") {
        let rest = &b[i + 2..];
        if !rest.is_empty() && rest.bytes().all(|c| c.is_ascii_digit()) {
            return format!("{b}/chat/completions");
        }
    }
    format!("{b}/v1/chat/completions")
}

fn is_anthropic_base(base: &str) -> bool {
    base.trim()
        .trim_end_matches('/')
        .to_ascii_lowercase()
        .starts_with("https://api.kimi.com/coding")
}

fn models_url(base: &str) -> String {
    let b = base
        .trim()
        .trim_end_matches('/')
        .strip_suffix("/chat/completions")
        .unwrap_or(base.trim().trim_end_matches('/'));
    if is_anthropic_base(b) {
        return format!("{b}/v1/models");
    }
    if b.ends_with("/models") {
        return b.to_string();
    }
    if let Some(i) = b.rfind("/v") {
        let rest = &b[i + 2..];
        if !rest.is_empty() && rest.bytes().all(|c| c.is_ascii_digit()) {
            return format!("{b}/models");
        }
    }
    format!("{b}/v1/models")
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct ChatBody<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(serde::Deserialize)]
struct ChatResponse {
    choices: Option<Vec<ChatChoice>>,
    error: Option<ApiError>,
}

#[derive(serde::Deserialize)]
struct ModelsResponse {
    data: Option<Vec<ModelItem>>,
    error: Option<ApiError>,
}

#[derive(serde::Deserialize)]
struct ModelItem {
    id: Option<String>,
}

#[derive(serde::Deserialize)]
struct AnthropicResponse {
    content: Option<Vec<AnthropicContent>>,
    error: Option<ApiError>,
}

#[derive(serde::Deserialize)]
struct AnthropicContent {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
}

#[derive(serde::Deserialize)]
struct ChatChoice {
    message: Option<ChatMsg>,
}

#[derive(serde::Deserialize)]
struct ChatMsg {
    content: Option<String>,
}

#[derive(serde::Deserialize)]
struct ApiError {
    message: Option<String>,
}

async fn post_chat(
    base: &str,
    model: &str,
    system: &str,
    user: &str,
    temperature: f32,
    max_tokens: Option<u32>,
    api_key: &str,
    cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<String, String> {
    if is_anthropic_base(base) {
        return post_anthropic_chat(
            base,
            model,
            system,
            user,
            temperature,
            max_tokens,
            api_key,
            cancel_rx,
        )
        .await;
    }
    let url = chat_url(base);
    let body = ChatBody {
        model,
        messages: vec![
            ChatMessage {
                role: "system",
                content: system,
            },
            ChatMessage {
                role: "user",
                content: user,
            },
        ],
        temperature,
        max_tokens,
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP 客户端失败: {e}"))?;

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body);
    if !api_key.is_empty() {
        req = req.bearer_auth(api_key);
    }

    let send = req.send();
    tokio::pin!(send);
    tokio::pin!(cancel_rx);

    let response = tokio::select! {
        biased;
        _ = &mut cancel_rx => {
            return Err("已取消".into());
        }
        res = &mut send => {
            res.map_err(|e| {
                if e.is_timeout() {
                    "请求超时".into()
                } else {
                    format!("网络错误: {e}")
                }
            })?
        }
    };

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;

    let parsed: ChatResponse = serde_json::from_str(&text).unwrap_or(ChatResponse {
        choices: None,
        error: None,
    });
    if let Some(err) = parsed.error {
        return Err(err
            .message
            .unwrap_or_else(|| format!("接口错误 HTTP {status}")));
    }
    if !status.is_success() {
        let snippet: String = text.chars().take(200).collect();
        return Err(format!("HTTP {status}: {snippet}"));
    }
    let content = parsed
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .unwrap_or_default()
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("模型返回空内容".into());
    }
    Ok(content)
}

async fn post_anthropic_chat(
    base: &str,
    model: &str,
    system: &str,
    user: &str,
    temperature: f32,
    max_tokens: Option<u32>,
    api_key: &str,
    cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<String, String> {
    let url = format!("{}/v1/messages", base.trim().trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "system": system,
        "messages": [{ "role": "user", "content": user }],
        "temperature": temperature,
        "max_tokens": max_tokens.unwrap_or(2048),
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP 客户端失败: {e}"))?;
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .json(&body);
    if !api_key.is_empty() {
        req = req.bearer_auth(api_key).header("x-api-key", api_key);
    }

    let send = req.send();
    tokio::pin!(send);
    tokio::pin!(cancel_rx);
    let response = tokio::select! {
        biased;
        _ = &mut cancel_rx => return Err("已取消".into()),
        res = &mut send => res.map_err(|e| {
            if e.is_timeout() { "请求超时".into() } else { format!("网络错误: {e}") }
        })?
    };
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    let parsed: AnthropicResponse = serde_json::from_str(&text).unwrap_or(AnthropicResponse {
        content: None,
        error: None,
    });
    if let Some(err) = parsed.error {
        return Err(err
            .message
            .unwrap_or_else(|| format!("接口错误 HTTP {status}")));
    }
    if !status.is_success() {
        let snippet: String = text.chars().take(200).collect();
        return Err(format!("HTTP {status}: {snippet}"));
    }
    let content = parsed
        .content
        .unwrap_or_default()
        .into_iter()
        .filter(|part| part.kind.as_deref().unwrap_or("text") == "text")
        .filter_map(|part| part.text)
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("模型返回空内容".into());
    }
    Ok(content)
}

#[tauri::command]
pub async fn ai_list_models(
    base_url: String,
    key: Option<String>,
    app: AppHandle,
) -> Result<Vec<String>, String> {
    let base = normalize_base(&base_url)?;
    let key = match key {
        Some(k) if !k.trim().is_empty() => k.trim().to_string(),
        _ => read_key(&app)?,
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP 客户端失败: {e}"))?;
    let mut req = client.get(models_url(&base));
    if !key.is_empty() {
        req = req.bearer_auth(&key);
        if is_anthropic_base(&base) {
            req = req
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01");
        }
    }
    let response = req.send().await.map_err(|e| {
        if e.is_timeout() {
            "请求超时".to_string()
        } else {
            format!("网络错误: {e}")
        }
    })?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    let parsed: ModelsResponse = serde_json::from_str(&text).unwrap_or(ModelsResponse {
        data: None,
        error: None,
    });
    if let Some(err) = parsed.error {
        return Err(err
            .message
            .unwrap_or_else(|| format!("接口错误 HTTP {status}")));
    }
    if !status.is_success() {
        let snippet: String = text.chars().take(200).collect();
        return Err(format!("HTTP {status}: {snippet}"));
    }
    let mut models: Vec<String> = parsed
        .data
        .unwrap_or_default()
        .into_iter()
        .filter_map(|m| m.id)
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    models.sort_unstable();
    models.dedup();
    if models.is_empty() {
        return Err("接口未返回可用模型".into());
    }
    Ok(models)
}

#[tauri::command]
pub async fn ai_test_connection(
    base_url: String,
    model: String,
    key: Option<String>,
    app: AppHandle,
    cancels: State<'_, AiCancelMap>,
) -> Result<String, String> {
    let base = normalize_base(&base_url)?;
    let model = model.trim();
    if model.is_empty() {
        return Err("请填写模型名".into());
    }
    let key = match key {
        Some(k) if !k.trim().is_empty() => k.trim().to_string(),
        _ => read_key(&app)?,
    };
    let id = format!("test-{}", now_ms());
    let (tx, rx) = tokio::sync::oneshot::channel();
    cancels.0.lock().unwrap().insert(id.clone(), tx);
    let result = post_chat(
        &base,
        model,
        "You are a connection probe. Reply with exactly: ok",
        "ping",
        0.0,
        Some(64),
        &key,
        rx,
    )
    .await;
    cancels.0.lock().unwrap().remove(&id);
    result.map(|_| "连接成功".into())
}

#[tauri::command]
pub async fn ai_chat(
    base_url: String,
    model: String,
    system: String,
    user: String,
    temperature: f32,
    max_tokens: Option<u32>,
    request_id: String,
    app: AppHandle,
    cancels: State<'_, AiCancelMap>,
) -> Result<String, String> {
    let base = normalize_base(&base_url)?;
    let model = model.trim();
    if model.is_empty() {
        return Err("请填写模型名".into());
    }
    if system.trim().is_empty() || user.trim().is_empty() {
        return Err("上下文为空".into());
    }
    let key = read_key(&app)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    cancels.0.lock().unwrap().insert(request_id.clone(), tx);
    let temp = temperature.clamp(0.0, 2.0);
    let result = post_chat(&base, model, &system, &user, temp, max_tokens, &key, rx).await;
    cancels.0.lock().unwrap().remove(&request_id);
    result
}

#[tauri::command]
pub fn ai_cancel(request_id: String, cancels: State<'_, AiCancelMap>) -> Result<(), String> {
    if let Some(tx) = cancels.0.lock().unwrap().remove(&request_id) {
        let _ = tx.send(());
    }
    Ok(())
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{chat_url, models_url};

    #[test]
    fn models_url_version_suffix() {
        assert_eq!(
            models_url("https://api.kimi.com/coding/"),
            "https://api.kimi.com/coding/v1/models"
        );
        assert_eq!(
            models_url("https://api.moonshot.cn/v1"),
            "https://api.moonshot.cn/v1/models"
        );
        assert_eq!(
            models_url("https://open.bigmodel.cn/api/paas/v4/"),
            "https://open.bigmodel.cn/api/paas/v4/models"
        );
        assert_eq!(
            models_url("https://api.deepseek.com/v1/chat/completions"),
            "https://api.deepseek.com/v1/models"
        );
    }

    #[test]
    fn chat_url_version_suffix() {
        assert_eq!(
            chat_url("https://api.kimi.com/coding/"),
            "https://api.kimi.com/coding/v1/messages"
        );
        assert_eq!(
            chat_url("https://api.moonshot.cn/v1"),
            "https://api.moonshot.cn/v1/chat/completions"
        );
        assert_eq!(
            chat_url("https://open.bigmodel.cn/api/paas/v4"),
            "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        );
        assert_eq!(
            chat_url("https://api.deepseek.com/v1/chat/completions"),
            "https://api.deepseek.com/v1/chat/completions"
        );
    }
}
