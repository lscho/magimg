#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .run(tauri::generate_context!())
        .expect("error while running huanhua ai");
}
