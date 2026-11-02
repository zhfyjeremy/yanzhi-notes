//! AI 助手 BYOK(PRD §7.8):Key 进系统钥匙串;请求直达用户 Base URL;可取消。
//! 无砚知中转。允许 http://127.0.0.1 对接本地 Ollama。

use keyring::Entry;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use url::Url;

const SERVICE: &str = "com.yanzhi.notes";
const ACCOUNT: &str = "ai-api-key";

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
pub fn set_ai_key(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return clear_ai_key();
    }
    key_entry()?
        .set_password(key)
        .map_err(|e| format!("写入 Key 失败: {e}"))
}

#[tauri::command]
pub fn clear_ai_key() -> Result<(), String> {
    match key_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("清除 Key 失败: {e}")),
    }
}

#[tauri::command]
pub fn has_ai_key() -> Result<bool, String> {
    match key_entry()?.get_password() {
        Ok(p) => Ok(!p.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("读取 Key 失败: {e}")),
    }
}

fn read_key() -> Result<String, String> {
    match key_entry()?.get_password() {
        Ok(p) if !p.trim().is_empty() => Ok(p),
        Ok(_) | Err(keyring::Error::NoEntry) => Err("未配置 API Key".into()),
        Err(e) => Err(format!("读取 Key 失败: {e}")),
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
        return Err(err.message.unwrap_or_else(|| format!("接口错误 HTTP {status}")));
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

#[tauri::command]
pub async fn ai_test_connection(
    base_url: String,
    model: String,
    cancels: State<'_, AiCancelMap>,
) -> Result<String, String> {
    let base = normalize_base(&base_url)?;
    let model = model.trim();
    if model.is_empty() {
        return Err("请填写模型名".into());
    }
    let key = read_key()?;
    let id = format!("test-{}", now_ms());
    let (tx, rx) = tokio::sync::oneshot::channel();
    cancels.0.lock().unwrap().insert(id.clone(), tx);
    let result = post_chat(
        &base,
        model,
        "You are a connection probe. Reply with exactly: ok",
        "ping",
        0.0,
        Some(8),
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
    let key = read_key()?;
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
    use super::chat_url;

    #[test]
    fn chat_url_version_suffix() {
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
