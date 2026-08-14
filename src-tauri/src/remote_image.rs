use std::time::Duration;

use image::ImageFormat;
use tauri::ipc::{Channel, Response};
use tauri_plugin_http::reqwest::{redirect::Policy, Client, Url};

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;

fn validate_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "远程图片地址无效。".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("远程图片只支持 HTTP 或 HTTPS 地址。".to_string());
    }
    Ok(url)
}

fn validate_image(bytes: Vec<u8>) -> Result<Response, String> {
    let format = image::guess_format(&bytes).map_err(|_| "远程文件不是有效图片。".to_string())?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err("远程图片格式不受支持。".to_string());
    }
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn download_remote_image(
    url: String,
    access_token: Option<String>,
    on_data: Channel<Response>,
) -> Result<(), String> {
    let client = Client::builder()
        .connect_timeout(DOWNLOAD_TIMEOUT)
        .timeout(DOWNLOAD_TIMEOUT)
        .redirect(Policy::limited(5))
        .build()
        .map_err(|error| format!("远程图片下载器初始化失败：{error}"))?;
    let mut request = client.get(validate_url(&url)?);
    if let Some(token) = access_token.filter(|value| !value.trim().is_empty()) {
        request = request.bearer_auth(token);
    }
    let mut response = request
        .send()
        .await
        .map_err(|error| format!("远程图片下载失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("远程图片下载失败（{}）。", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_IMAGE_BYTES as u64)
    {
        return Err("远程图片超过 64 MiB 上限。".to_string());
    }

    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(MAX_IMAGE_BYTES as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("远程图片读取失败：{error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
            return Err("远程图片超过 64 MiB 上限。".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err("远程图片内容为空。".to_string());
    }
    on_data
        .send(validate_image(bytes)?)
        .map_err(|error| format!("远程图片返回失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::{validate_image, validate_url};

    #[test]
    fn accepts_only_http_image_urls() {
        assert!(validate_url("https://example.com/image.png").is_ok());
        assert!(validate_url("http://127.0.0.1:23000/image.png").is_ok());
        assert!(validate_url("file:///tmp/image.png").is_err());
        assert!(validate_url("not-a-url").is_err());
    }

    #[test]
    fn rejects_non_image_payloads() {
        assert!(validate_image(b"not an image".to_vec()).is_err());
    }
}
