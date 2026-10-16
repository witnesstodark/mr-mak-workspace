//! macOS counterpart of the Win-key recall: a global ⌃⌥⌘Space shortcut brings
//! back the open Mr. Mak windows. Only this one chord is registered; no other
//! key input is observed. macOS ships no binding for it: ⌃Space and ⌃⌥Space
//! switch input sources, ⌘Space and ⌥⌘Space are Spotlight and Finder search,
//! and ⌃⌘Space is the emoji picker.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

pub const LABEL: &str = "⌃⌥⌘Space";

pub fn shortcut() -> Shortcut { Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER), Code::Space) }

pub struct RecallShortcut { app: tauri::AppHandle, enabled: AtomicBool }

impl RecallShortcut {
    pub fn start(app: &tauri::AppHandle, enabled: bool) -> Result<Self, String> {
        let shortcut = Self { app: app.clone(), enabled: AtomicBool::new(false) };
        if enabled { shortcut.set_enabled(true)?; }
        Ok(shortcut)
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        if enabled == self.enabled() { return Ok(()); }
        let shortcuts = self.app.global_shortcut();
        let result = if enabled { shortcuts.register(shortcut()) } else { shortcuts.unregister(shortcut()) };
        result.map_err(|error| format!("macOS could not {} {LABEL}: {error}", if enabled { "register" } else { "release" }))?;
        self.enabled.store(enabled, Ordering::Relaxed);
        Ok(())
    }

    pub fn enabled(&self) -> bool { self.enabled.load(Ordering::Relaxed) }
}
