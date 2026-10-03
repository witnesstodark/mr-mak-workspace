#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}};
use tauri_plugin_window_state::StateFlags;
mod external_links;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

struct Service(Mutex<Option<Child>>);
#[cfg(windows)]
struct ServiceJob(Mutex<Option<OwnedHandle>>);
#[cfg(windows)]
mod window_identity;
#[cfg(windows)]
mod win_key;

#[cfg(windows)]
fn process_job(child: &Child) -> Result<OwnedHandle, Box<dyn std::error::Error>> {
    use windows_sys::Win32::System::JobObjects::*;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() { return Err(std::io::Error::last_os_error().into()); }
        let owned = OwnedHandle::from_raw_handle(job);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32) == 0
            || AssignProcessToJobObject(job, child.as_raw_handle()) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(owned)
    }
}

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)] command.creation_flags(0x08000000);
    command
}

fn reveal(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
    }
}

fn requested_window(args: &[String]) -> Option<&str> {
    args.windows(2).find_map(|pair| {
        if pair[0] == "--show" && matches!(pair[1].as_str(), "chats" | "workspace") { Some(pair[1].as_str()) } else { None }
    })
}

fn recall_open_windows(app: &tauri::AppHandle) {
    // Closing Workspace hides it; minimizing preserves its visible/open state.
    if app.get_webview_window("workspace").is_some_and(|window| window.is_visible().unwrap_or(false)) {
        reveal(app, "workspace");
    }
    reveal(app, "chats");
}

#[cfg(windows)]
fn publish_shortcut(app: &tauri::AppHandle, request_id: Option<&str>, error: Option<String>) {
    let available = app.try_state::<win_key::WinKeyShortcut>().is_some();
    let enabled = app.try_state::<win_key::WinKeyShortcut>().is_some_and(|shortcut| shortcut.enabled());
    if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() { let _ = item.set_checked(enabled); }
    let event = serde_json::json!({ "type": "native-settings", "requestId": request_id, "available": available, "winKey": enabled && available, "error": error });
    if let Some(child) = app.state::<Service>().0.lock().unwrap().as_mut() {
        if let Some(stdin) = child.stdin.as_mut() { let _ = writeln!(stdin, "{event}"); }
    }
}

#[cfg(windows)]
fn set_shortcut(app: &tauri::AppHandle, enabled: bool, request_id: Option<&str>) {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let shortcut = app.try_state::<win_key::WinKeyShortcut>().ok_or("Windows shortcut unavailable")?;
        let folder = app.path().app_config_dir()?;
        fs::create_dir_all(&folder)?;
        fs::write(folder.join("windows-key.json"), if enabled { "true" } else { "false" })?;
        shortcut.set_enabled(enabled);
        if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() { item.set_checked(enabled)?; }
        Ok(())
    })();
    publish_shortcut(app, request_id, result.err().map(|error| error.to_string()));
}

#[cfg(windows)]
fn start_file_drag(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    let Some(window) = app.get_webview_window("workspace") else { return };
    let _ = app.run_on_main_thread(move || {
        let callback_window = window.clone();
        let result = drag::start_drag(
            &window, drag::DragItem::Files(paths),
            drag::Image::Raw(include_bytes!("../icons/32x32.png").to_vec()),
            move |result, _| {
                let detail = serde_json::json!({ "dropped": matches!(result, drag::DragResult::Dropped) });
                let _ = callback_window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-native-drag-result',{{detail:{detail}}}))"));
            }, drag::Options::default(),
        );
        if let Err(error) = result {
            let detail = serde_json::json!({ "dropped": false, "error": error.to_string() });
            let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-native-drag-result',{{detail:{detail}}}))"));
        }
    });
}

fn repo_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let config = app.path().app_config_dir()?.join("repository.json");
    let args: Vec<String> = std::env::args().collect();
    let supplied = args.iter().position(|v| v == "--repo").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let saved = fs::read_to_string(&config).ok().and_then(|s| serde_json::from_str::<String>(&s).ok()).map(PathBuf::from);
    let current = std::env::current_dir().ok().filter(|root| root.join("workspace/workspace.json").is_file());
    let mut selected = supplied.or(saved).or(current);
    loop {
        if let Some(ref root) = selected {
            if root.join("workspace/workspace.json").is_file() {
                fs::create_dir_all(config.parent().unwrap())?;
                fs::write(&config, serde_json::to_string(&root.to_string_lossy())?)?;
                return Ok(root.to_owned());
            }
        }
        selected = rfd::FileDialog::new().set_title("Choose your Mr. Mak Workspace repository").pick_folder();
        if selected.is_none() { return Err("No Workspace repository selected".into()); }
        if !selected.as_ref().unwrap().join("workspace/workspace.json").is_file() {
            rfd::MessageDialog::new().set_title("Choose the Workspace folder").set_description("Select the repository folder containing workspace/workspace.json.").show();
        }
    }
}

fn normalize_node_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

fn make_windows(app: &tauri::AppHandle, workspace: &str, chats: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (mut x, mut y, mut width, mut height) = (0.0, 0.0, 1440.0, 900.0);
    if let Some(monitor) = app.primary_monitor()? {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        x = area.position.x as f64 / scale; y = area.position.y as f64 / scale;
        width = area.size.width as f64 / scale; height = area.size.height as f64 / scale;
    }
    let chat_width = (width * 0.27).clamp(360.0, 560.0);
    let workspace_window = WebviewWindowBuilder::new(app, "workspace", WebviewUrl::External(workspace.parse()?))
        .on_new_window(|url, _| external_links::open_popup(url))
        .disable_drag_drop_handler().visible(false)
        .title(format!("{} — Workspace", app.config().product_name.as_deref().unwrap_or("Mr. Mak"))).inner_size((width - chat_width - 8.0).max(500.0), (height - 6.0).max(450.0))
        .position(x + chat_width + 6.0, y + 2.0).min_inner_size(500.0, 400.0)
        .theme(Some(tauri::Theme::Dark)).background_color(tauri::webview::Color(12, 13, 16, 255)).build()?;
    let chats_window = WebviewWindowBuilder::new(app, "chats", WebviewUrl::External(chats.parse()?))
        .on_new_window(|url, _| external_links::open_popup(url))
        .visible(false)
        .title(format!("{} — Chats", app.config().product_name.as_deref().unwrap_or("Mr. Mak"))).inner_size(chat_width, (height - 6.0).max(450.0))
        .position(x + 2.0, y + 2.0).min_inner_size(330.0, 420.0)
        .theme(Some(tauri::Theme::Dark)).background_color(tauri::webview::Color(12, 13, 16, 255)).build()?;
    // Native drops expose every original file/folder path. Keep Workspace's
    // browser drop handler for imports, and use this only in the Chats window.
    let drop_window = chats_window.clone();
    chats_window.on_window_event(move |event| {
        if let tauri::WindowEvent::DragDrop(event) = event {
            let scale = drop_window.scale_factor().unwrap_or(1.0);
            let detail = match event {
                tauri::DragDropEvent::Enter { paths, position } => serde_json::json!({ "phase": "enter", "paths": paths, "x": position.x / scale, "y": position.y / scale }),
                tauri::DragDropEvent::Over { position } => serde_json::json!({ "phase": "over", "x": position.x / scale, "y": position.y / scale }),
                tauri::DragDropEvent::Drop { paths, position } => serde_json::json!({ "phase": "drop", "paths": paths, "x": position.x / scale, "y": position.y / scale }),
                tauri::DragDropEvent::Leave => serde_json::json!({ "phase": "leave" }),
                _ => return,
            };
            let _ = drop_window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-file-drop',{{detail:{detail}}}))"));
        }
    });
    let args: Vec<String> = std::env::args().collect();
    let selected = requested_window(&args);
    for window in [workspace_window, chats_window] {
        #[cfg(windows)]
        window_identity::set_window(&window)?;
        let handle = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close(); let _ = handle.hide();
            }
        });
        if selected.is_none() || selected == Some(window.label()) { window.show()?; }
    }
    #[cfg(windows)]
    window_identity::refresh_shortcuts(app);
    Ok(())
}

fn main() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|arg| arg == "--quit") { app.exit(0); }
            else if let Some(label) = requested_window(&args) { reveal(app, label); }
            else { reveal(app, "workspace"); reveal(app, "chats"); }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED).build())
        .manage(Service(Mutex::new(None)))
        .setup(|app| {
            if std::env::args().any(|arg| arg == "--quit") { app.handle().exit(0); return Ok(()); }
            #[cfg(windows)]
            window_identity::initialize(app.handle())?;
            let repo = repo_path(app.handle())?;
            let resource_dir = app.path().resource_dir()?;
            let runtime = resource_dir.join("runtime");
            let runtime_node = if cfg!(windows) { runtime.join("node.exe") } else { runtime.join("node") };
            let (node, script, ui) = if runtime_node.is_file() {
                (runtime_node, runtime.join("service/main.mjs"), runtime.join("ui"))
            } else {
                (PathBuf::from("node"), repo.join("desktop/service/main.mjs"), repo.join("dist"))
            };
            let script = normalize_node_path(script);
            let logs = app.path().app_log_dir()?; fs::create_dir_all(&logs)?;
            let log = fs::OpenOptions::new().create(true).append(true).open(logs.join("service.log"))?;
            let mut command = Command::new(node);
            command.arg(script).arg("--repo").arg(&repo).arg("--ui").arg(ui).current_dir(&repo)
                .env("MRMAK_PARENT_PID", std::process::id().to_string()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log));
            let mut child = hidden(&mut command).spawn()?;
            // The job contains only this app's service and descendants. Quitting
            // or a host crash cannot leave managed CLI/MCP processes behind.
            #[cfg(windows)]
            app.manage(ServiceJob(Mutex::new(Some(process_job(&child)?))));
            let stdout = child.stdout.take().ok_or("Service output unavailable")?;
            *app.state::<Service>().0.lock().unwrap() = Some(child);
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                    match event["type"].as_str().unwrap_or("") {
                        #[cfg(windows)]
                        "native-settings" => {
                            if let Some(enabled) = event["winKey"].as_bool() {
                                let handle = app_handle.clone();
                                let request_id = event["requestId"].as_str().map(str::to_owned);
                                let _ = app_handle.run_on_main_thread(move || set_shortcut(&handle, enabled, request_id.as_deref()));
                            }
                        },
                        "ready" => {
                            let handle = app_handle.clone();
                            let workspace = event["workspace"].as_str().unwrap_or("").to_owned();
                            let chats = event["chats"].as_str().unwrap_or("").to_owned();
                            let _ = app_handle.run_on_main_thread(move || {
                                if let Err(error) = make_windows(&handle, &workspace, &chats) {
                                    rfd::MessageDialog::new().set_title("Mr. Mak could not open").set_description(error.to_string()).show(); handle.exit(1);
                                }
                            });
                        },
                        "window" => {
                            let label = event["window"].as_str().unwrap_or("");
                            if let Some(window) = app_handle.get_webview_window(label) {
                                match event["action"].as_str().unwrap_or("") {
                                    "show" => reveal(&app_handle, label),
                                    "hide" => { let _ = window.hide(); },
                                    "minimize" => { let _ = window.minimize(); },
                                    "pin" => { let _ = window.set_always_on_top(event["value"].as_bool().unwrap_or(false)); },
                                    _ => {}
                                }
                            }
                        },
                        "recycle-file" => {
                            if let Some(file) = event["path"].as_str() {
                                if let Some(window) = app_handle.get_webview_window("workspace") {
                                    let file = file.to_owned();
                                    std::thread::spawn(move || {
                                        let detail = match trash::delete(&file) {
                                            Ok(()) => serde_json::json!({ "path": file, "recycled": true }),
                                            Err(error) => serde_json::json!({ "path": file, "recycled": false, "error": error.to_string() }),
                                        };
                                        let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-recycle-result',{{detail:{detail}}}))"));
                                    });
                                }
                            }
                        },
                        #[cfg(windows)]
                        "drag-files" => {
                            if let Some(paths) = event["paths"].as_array() {
                                let paths: Vec<PathBuf> = paths.iter().filter_map(|p| p.as_str().map(PathBuf::from)).collect();
                                if !paths.is_empty() { start_file_drag(&app_handle, paths); }
                            }
                        },
                        "pick-files" => {
                            if let (Some(window), Some(request_id)) = (app_handle.get_webview_window("chats"), event["requestId"].as_str()) {
                                let request_id = request_id.to_owned();
                                std::thread::spawn(move || {
                                    let paths = rfd::FileDialog::new().set_parent(&window).set_title("Attach file paths").pick_files().unwrap_or_default();
                                    let detail = serde_json::json!({ "requestId": request_id, "paths": paths });
                                    let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-picked-files',{{detail:{detail}}}))"));
                                });
                            }
                        },
                        "reveal" => { if let Some(file) = event["path"].as_str() { let _ = external_links::reveal_path(file); } },
                        _ => {}
                    }
                }
                if app_handle.get_webview_window("workspace").is_none() {
                    rfd::MessageDialog::new().set_title("Mr. Mak service did not start").set_description("The local service stopped before opening the windows. See the Mr. Mak service.log in your local application data.").show();
                    app_handle.exit(1);
                }
            });
            let workspace_item = MenuItem::with_id(app, "workspace", "Show Workspace", true, None::<&str>)?;
            let chats_item = MenuItem::with_id(app, "chats", "Show Chats", true, None::<&str>)?;
            let both_item = MenuItem::with_id(app, "both", "Show both windows", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Mr. Mak and stop terminals", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&workspace_item, &chats_item, &both_item, &separator, &quit_item])?;
            #[cfg(windows)]
            {
                let preference = app.path().app_config_dir()?.join("windows-key.json");
                let enabled = fs::read_to_string(&preference).ok().and_then(|text| serde_json::from_str::<bool>(&text).ok()).unwrap_or(false);
                let shortcut = win_key::WinKeyShortcut::start(app.handle(), enabled);
                let available = shortcut.is_ok();
                if let Ok(shortcut) = shortcut { app.manage(shortcut); }
                let item = CheckMenuItem::with_id(app, "win-key", "Win key shows Mr. Mak", available, enabled && available, None::<&str>)?;
                menu.insert(&item, 3)?;
                app.manage(item);
                publish_shortcut(app.handle(), None, if available { None } else { Some("Windows could not register the shortcut.".into()) });
            }
            TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone()).tooltip("Mr. Mak — your agents, close at hand")
                .menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "workspace" => reveal(app, "workspace"), "chats" => reveal(app, "chats"),
                    "both" => { reveal(app, "workspace"); reveal(app, "chats"); }, "quit" => app.exit(0),
                    #[cfg(windows)]
                    "win-key" => {
                        if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() {
                            if let Ok(enabled) = item.is_checked() {
                                set_shortcut(app, enabled, None);
                            }
                        }
                    },
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| { if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { reveal(tray.app_handle(), "chats"); } })
                .build(app)?;
            Ok(())
        }).build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(windows)]
                if let Some(shortcut) = app.try_state::<win_key::WinKeyShortcut>() { shortcut.shutdown(); }
                if let Some(mut child) = app.state::<Service>().0.lock().unwrap().take() {
                    if let Some(mut stdin) = child.stdin.take() { let _ = stdin.write_all(b"quit\n"); }
                    for _ in 0..80 { if child.try_wait().ok().flatten().is_some() { break; } std::thread::sleep(std::time::Duration::from_millis(100)); }
                    let _ = child.kill(); let _ = child.wait();
                }
                #[cfg(windows)]
                if let Some(job) = app.try_state::<ServiceJob>() { job.0.lock().unwrap().take(); }
            }
        }),
        Err(error) => { rfd::MessageDialog::new().set_title("Mr. Mak could not start").set_description(error.to_string()).show(); }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_node_path;
    use std::path::PathBuf;

    #[test]
    fn normalize_node_path_removes_windows_extended_prefixes() {
        assert_eq!(normalize_node_path(PathBuf::from(r"\\?\C:\Mr Mak\service\main.mjs")), PathBuf::from(r"C:\Mr Mak\service\main.mjs"));
        assert_eq!(normalize_node_path(PathBuf::from(r"\\?\UNC\server\share\service\main.mjs")), PathBuf::from(r"\\server\share\service\main.mjs"));
        assert_eq!(normalize_node_path(PathBuf::from(r"C:\Mr Mak\service\main.mjs")), PathBuf::from(r"C:\Mr Mak\service\main.mjs"));
    }
}
