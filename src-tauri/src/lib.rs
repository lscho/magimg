mod auto_layer;
mod compression;
mod cutout;
mod remote_image;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(cutout::CutoutState::default())
        .manage(auto_layer::AutoLayerState::default())
        .manage(compression::CompressionState::default())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|_app| {
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;

                let window = _app
                    .get_webview_window("main")
                    .expect("main window should be available");
                window.set_decorations(false)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_devtools,
            cutout::cutout_encode,
            cutout::cutout_decode,
            cutout::cutout_auto_propose,
            cutout::cutout_refine,
            cutout::cutout_repair,
            cutout::cutout_birefnet_segment,
            cutout::cutout_cancel,
            cutout::cutout_release,
            auto_layer::auto_layer_ocr,
            auto_layer::auto_layer_ocr_line,
            auto_layer::auto_layer_classify,
            auto_layer::auto_layer_release,
            auto_layer::auto_layer_selection_source_exists,
            auto_layer::auto_layer_read_selection_source,
            compression::compression_prepare,
            compression::compression_thumbnail,
            compression::compression_run,
            compression::compression_save,
            compression::compression_auto_layer_upload,
            compression::compression_cancel,
            compression::compression_release,
            remote_image::download_remote_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running huanhua ai");
}

// 开发模式下打开/关闭调试控制台（DevTools）。
// 仅 debug 构建下生效；release 构建调用为空操作，不会编译进 DevTools 功能。
// 前端通过 invoke("toggle_devtools") 触发，快捷键绑定见 src/App.vue。
#[tauri::command(name = "toggle-devtools")]
fn toggle_devtools(webview: tauri::Webview) {
    #[cfg(debug_assertions)]
    {
        let was_open = webview.is_devtools_open();
        eprintln!("[devtools] toggle invoked, was_open={was_open}");
        if was_open {
            webview.close_devtools();
        } else {
            webview.open_devtools();
        }
        eprintln!(
            "[devtools] after toggle, is_open={}",
            webview.is_devtools_open()
        );
    }
}
