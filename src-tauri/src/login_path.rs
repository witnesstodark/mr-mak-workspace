//! Finder launches with a sparse PATH and none of the user's shell exports.
//! Shell customization is optional and bounded.
use std::path::{Path, PathBuf};

/// Config-location and locale variables taken from the login shell when the
/// app's own environment lacks them. Never API keys or tokens.
#[cfg(any(target_os = "macos", test))]
pub const IMPORTED: [&str; 11] = [
    "CODEX_HOME", "CLAUDE_CONFIG_DIR", "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR",
    "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME",
    "LANG", "LC_ALL", "LC_CTYPE",
];

pub fn fallback(home: Option<&Path>, inherited: &str) -> String {
    let mut entries: Vec<PathBuf> = std::env::split_paths(inherited).filter(|p| !p.as_os_str().is_empty()).collect();
    let mut extra = Vec::new();
    if let Some(home) = home {
        for suffix in [".local/bin", ".npm-global/bin", ".cargo/bin"] { extra.push(home.join(suffix)); }
    }
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] { extra.push(directory.into()); }
    for entry in extra { if !entries.contains(&entry) { entries.push(entry); } }
    std::env::join_paths(entries).map(|value| value.to_string_lossy().into_owned()).unwrap_or_else(|_| inherited.to_owned())
}

#[cfg(unix)]
fn bounded_output(command: &mut std::process::Command, timeout: std::time::Duration) -> Option<String> {
    use std::{io::Read, os::unix::process::CommandExt, process::Stdio, sync::mpsc, thread, time::{Duration, Instant}};
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    // A new session, not just a process group: an interactive shell with a
    // controlling terminal (tauri dev, binary run from Terminal) would open
    // /dev/tty from the background and stop on SIGTTIN until the timeout.
    // setsid also makes the pid the group id that is killed below.
    unsafe {
        command.pre_exec(|| if libc::setsid() == -1 { Err(std::io::Error::last_os_error()) } else { Ok(()) });
    }
    let mut child = command.spawn().ok()?;
    let group = child.id() as i32;
    let output = child.stdout.take()?;
    let (send, receive) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = output.take(65537).read_to_end(&mut bytes);
        let _ = send.send(if result.is_ok() && bytes.len() <= 65536 { String::from_utf8(bytes).ok() } else { None });
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Err(_) => break None,
            Ok(None) if Instant::now() >= deadline => break None,
            Ok(None) => thread::sleep(Duration::from_millis(10)),
        }
    };
    // Kill only the private probe's process group, including children holding
    // stdout open. Never wait for a login script or pipe reader indefinitely.
    unsafe { libc::kill(-group, libc::SIGKILL); }
    let _ = child.wait();
    if !status.is_some_and(|status| status.success()) { return None; }
    receive.recv_timeout(Duration::from_millis(100)).ok().flatten()
}

// Parse `__MRMAK_PATH__<path>__MRMAK_END__` followed by NUL-terminated
// NAME=value pairs. Output from rc files before the marker is ignored.
#[cfg(any(target_os = "macos", test))]
fn parse_probe(text: &str) -> Option<(String, Vec<(String, String)>)> {
    let (_, rest) = text.rsplit_once("__MRMAK_PATH__")?;
    let (path, rest) = rest.split_once("__MRMAK_END__")?;
    if path.is_empty() || path.contains(['\n', '\r', '\0']) { return None; }
    let vars = rest.split_terminator('\0').filter_map(|pair| pair.split_once('='))
        .filter(|(name, value)| IMPORTED.contains(name) && !value.is_empty() && !value.contains(['\n', '\r']))
        .map(|(name, value)| (name.to_owned(), value.to_owned())).collect();
    Some((path.to_owned(), vars))
}

/// The login shell's PATH (or a fallback) and the `IMPORTED` variables it sets.
#[cfg(target_os = "macos")]
pub fn discover() -> (String, Vec<(String, String)>) {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    // awk prints the variables, so the probe stays valid in zsh, bash and fish.
    let script = format!(
        "printf '__MRMAK_PATH__%s__MRMAK_END__' \"$PATH\"; /usr/bin/awk 'BEGIN {{ for (i = 1; i < ARGC; i++) if (ARGV[i] in ENVIRON) printf \"%s=%s%c\", ARGV[i], ENVIRON[ARGV[i]], 0 }}' {}",
        IMPORTED.join(" ")
    );
    let mut command = std::process::Command::new(shell);
    command.args(["-ilc", &script]);
    bounded_output(&mut command, std::time::Duration::from_millis(2000))
        .and_then(|text| parse_probe(&text))
        .unwrap_or_else(|| (fallback(home.as_deref(), &inherited), Vec::new()))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{process::Command, time::{Duration, Instant}};
    #[test]
    fn returns_output_without_waiting_for_background_children() {
        let start = Instant::now();
        assert_eq!(bounded_output(Command::new("/bin/sh").args(["-c", "sleep 30 & printf ready"]), Duration::from_millis(100)), Some("ready".into()));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn timeout_and_excess_output_fall_back() {
        let start = Instant::now();
        assert!(bounded_output(Command::new("/bin/sh").args(["-c", "sleep 30"]), Duration::from_millis(100)).is_none());
        assert!(start.elapsed() < Duration::from_secs(2));
        assert!(bounded_output(Command::new("/bin/sh").args(["-c", "yes x | head -c 70000"]), Duration::from_millis(500)).is_none());
    }
    #[test]
    fn interactive_shell_does_not_stop_on_a_controlling_terminal() {
        // Meaningful when the tests run in a terminal: a zsh in the old
        // background process group stopped there until the timeout.
        if !Path::new("/bin/zsh").exists() { return; }
        let start = Instant::now();
        assert_eq!(bounded_output(Command::new("/bin/zsh").args(["-fic", "printf ok"]), Duration::from_millis(1500)), Some("ok".into()));
        assert!(start.elapsed() < Duration::from_millis(1500));
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "Runs the user's real login shell"]
    fn discover_reads_the_login_shell() {
        let (path, vars) = discover();
        assert!(path.split(':').any(|entry| entry == "/usr/bin"), "{path}");
        assert!(vars.iter().any(|(name, _)| name == "LANG"), "{vars:?}");
    }
    #[test]
    fn probe_output_keeps_path_and_only_allowlisted_variables() {
        let text = "rc noise __MRMAK_PATH__/bin__MRMAK_END__ \
                    __MRMAK_PATH__/opt/homebrew/bin:/bin__MRMAK_END__CODEX_HOME=/Users/test/a b\0LANG=en_US.UTF-8\0\
                    OPENAI_API_KEY=secret\0XDG_CONFIG_HOME=\0LC_ALL=x\ny\0bye";
        let (path, vars) = parse_probe(text).unwrap();
        assert_eq!(path, "/opt/homebrew/bin:/bin");
        assert_eq!(vars, vec![("CODEX_HOME".into(), "/Users/test/a b".into()), ("LANG".into(), "en_US.UTF-8".into())]);
        assert!(parse_probe("__MRMAK_PATH____MRMAK_END__").is_none());
        assert!(parse_probe("no markers").is_none());
    }
    #[test]
    fn fallback_preserves_custom_path_and_adds_common_cli_locations() {
        let value = fallback(Some(Path::new("/Users/test")), "/custom/bin:/bin");
        assert!(value.starts_with("/custom/bin:/bin:"));
        assert!(value.contains("/Users/test/.local/bin"));
        assert!(value.contains("/opt/homebrew/bin"));
        assert_eq!(value.split(':').filter(|p| *p == "/bin").count(), 1);
    }
}
