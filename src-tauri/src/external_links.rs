// Open web links outside the service's process job and outside the app webview.
// Pass the URL directly to the OS; never interpolate it into a shell command.
fn is_web_url(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "https" | "http") && url.host_str().is_some()
}

pub fn open_popup(url: tauri::Url) -> tauri::webview::NewWindowResponse<tauri::Wry> {
    if is_web_url(&url) {
        std::thread::spawn(move || {
            if let Err(error) = open_browser(&url) {
                rfd::MessageDialog::new()
                    .set_title("Could not open your browser")
                    .set_description(format!("{error}\nCheck the default browser in your system settings."))
                    .set_level(rfd::MessageLevel::Error)
                    .show();
            }
        });
    }
    tauri::webview::NewWindowResponse::Deny
}

#[cfg(windows)]
fn open_browser(url: &tauri::Url) -> Result<(), String> {
    use windows_sys::Win32::{System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED}, UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL}};
    if !is_web_url(url) { return Err("Only HTTP and HTTPS browser links are supported.".into()); }
    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = url.as_str().encode_utf16().chain(Some(0)).collect();
    unsafe {
        let initialized = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        let result = ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) as isize;
        if initialized >= 0 { CoUninitialize(); }
        if result > 32 { Ok(()) } else { Err(format!("Windows could not open this web link (code {result}).")) }
    }
}

// Start a helper without blocking the caller, and reap it once it exits so it
// never lingers as a zombie.
#[cfg(not(windows))]
fn spawn_reaped(command: &mut std::process::Command) -> std::io::Result<()> {
    let mut child = command.spawn()?;
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}

// Finder shows a package (an .app, .rtfd, .xcodeproj …) as a single file, and
// `open` on it would launch it, so it is revealed like a file.
#[cfg(not(windows))]
fn is_package(target: &std::path::Path) -> bool {
    const EXTENSIONS: [&str; 11] = ["xcodeproj", "xcworkspace", "rtfd", "xcassets", "playground", "pages", "numbers", "key", "photoslibrary", "scptd", "lproj"];
    cfg!(target_os = "macos") && target.is_dir() && (target.join("Contents/Info.plist").is_file()
        || target.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())))
}

#[cfg(not(windows))]
fn open_browser(url: &tauri::Url) -> Result<(), String> {
    use std::process::Command;
    let program = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    spawn_reaped(Command::new(program).arg(url.as_str())).map_err(|error| format!("Could not start {program}: {error}"))
}

pub fn reveal_path(path: &str) -> Result<(), String> {
    use std::path::Path;
    use std::process::Command;
    let target = Path::new(path);
    #[cfg(windows)]
    {
        let mut command = Command::new("explorer.exe");
        if target.is_dir() { command.arg(target); } else { command.arg(format!("/select,{}", target.display())); }
        command.spawn().map(|_| ()).map_err(|error| format!("Could not open Explorer: {error}"))
    }
    #[cfg(not(windows))]
    {
        // Finder can select the file itself; xdg-open can only open its folder.
        if cfg!(target_os = "macos") && (!target.is_dir() || is_package(target)) {
            return spawn_reaped(Command::new("open").arg("-R").arg(target)).map_err(|error| format!("Could not open Finder: {error}"));
        }
        let folder = if target.is_dir() { target } else { target.parent().unwrap_or(target) };
        let program = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        spawn_reaped(Command::new(program).arg(folder)).map_err(|error| format!("Could not start {program}: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_web_links_without_rewriting_query_or_fragment() {
        for text in ["https://example.com/page?x=1&y=two#part", "http://localhost:3000/docs", "https://higgsfield.ai/plugins/blender?fpr=stefan84"] {
            let url = tauri::Url::parse(text).unwrap();
            assert!(is_web_url(&url));
            assert_eq!(url.as_str(), text);
        }
        for text in ["javascript:alert(1)", "file:///C:/Windows/notepad.exe", "data:text/html,test", "mailto:test@example.com", "ms-settings:defaultapps"] {
            assert!(!is_web_url(&tauri::Url::parse(text).unwrap()));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn packages_are_revealed_like_files() {
        let root = std::env::temp_dir().join(format!("mrmak-package-test-{}", std::process::id()));
        for folder in ["Plain", "Tool.app/Contents", "Notes.RTFD"] { std::fs::create_dir_all(root.join(folder)).unwrap(); }
        std::fs::write(root.join("Tool.app/Contents/Info.plist"), "").unwrap();
        assert!(!is_package(&root.join("Plain")));
        assert!(is_package(&root.join("Tool.app")));
        assert!(is_package(&root.join("Notes.RTFD")));
        assert!(!is_package(&root.join("missing.rtfd")));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Opens one local verification page in the Windows default browser"]
    fn default_browser_reaches_local_page() {
        use std::{io::{Read, Write}, net::TcpListener, time::{Duration, Instant}};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = tauri::Url::parse(&format!("http://{}/mrmak-browser-check?from=chat&check=links", listener.local_addr().unwrap())).unwrap();
        open_browser(&url).unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if let Ok((mut stream, _)) = listener.accept() {
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = [0; 4096];
                let count = stream.read(&mut request).unwrap();
                assert!(String::from_utf8_lossy(&request[..count]).contains("GET /mrmak-browser-check?from=chat&check=links "));
                let body = "<!doctype html><html lang='en'><meta charset='utf-8'><title>Mr. Mak browser check</title><body style='background:#101115;color:#eee;font:20px system-ui;padding:48px'><h1>Browser links work.</h1><p>Mr. Mak opened your default browser. You can close this test tab.</p></body></html>";
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
                break;
            }
            assert!(Instant::now() < deadline, "Default browser did not reach the local verification page");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
