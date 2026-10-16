# Mr. Mak Workspace on macOS

The desktop app was built for Windows (and Linux). This document covers the macOS port:
what changed, how to build and run it, how it was verified, and what is still open.
The contributor reports native Apple Silicon operation and the checks below
for PR #25. The combined 0.5.1 update adds CI verification and a bounded login-shell
probe; its build status is tracked by the repository's Checks workflow.

## Build and run

GitHub Releases also carry an Apple Silicon `.dmg` and `.app.zip`; the steps below build
the same app from source.

Prerequisites: Node.js 22.20+, [Rust](https://rustup.rs), Xcode Command Line Tools
(`xcode-select --install`; `./setup.sh check` reports them), and at least one agent CLI
(Claude Code, Codex or OpenCode).

```bash
./setup.sh check      # report prerequisites
./setup.sh desktop    # npm ci + build Mr. Mak Workspace.app and a .dmg
./setup.sh preview    # optional: browser-only report preview, no Rust or Xcode needed
```

Output: `src-tauri/target/release/bundle/macos/Mr. Mak Workspace.app` (and `bundle/dmg/`).
Copy the app to Applications and double-click **Start Mr. Mak.command** in the repository,
which opens the app on this repository. The launcher warns when the build folder holds a
newer app than Applications and prints the replace command. The build is signed ad hoc
(`signingIdentity "-"`, no hardened runtime) and sealed, but not notarised. A copy you
build yourself opens without a Gatekeeper prompt. A downloaded copy may be blocked: use
System Settings › Privacy & Security › Open Anyway, or, if macOS calls it damaged, run
`xattr -dr com.apple.quarantine "/Applications/Mr. Mak Workspace.app"` once. macOS asks
again for permissions (e.g. microphone) after each rebuild, because an ad-hoc signature
changes with every build. Image and report downloads go to `~/Downloads` and are selected
in Finder. To update, follow the
[macOS update steps](updating.md#macos-source-build).

Optional local dictation and Read aloud need Python 3.10–3.12. The system `python3` is 3.9
and Homebrew's default is usually newer, so install and call 3.12 by name:
`brew install python@3.12`, then `python3.12 scripts/setup-local-voice.py dictation`
(or `read-aloud`). Plain `python3` also works when a Python 3.10–3.12 is installed
(Homebrew or uv): the script switches to it, and it handles the python.org installer's
missing certificates. On Apple Silicon, local dictation needs macOS 14 or later and Read
aloud macOS 13 or later (the pinned `av` and `onnxruntime` wheels); the script stops on older
versions. See [local voice setup](mobile-access.md#local-voice-setup-on-the-computer).

Development: `./node_modules/.bin/tauri dev -- -- --repo "$PWD"`. Without `--repo`,
`tauri dev` starts in `src-tauri/` and waits on a (hidden) repository picker. Dev mode serves
`dist/`; run `npm run build` first.

## What changed

### Native app (`src-tauri/`)
| Change | Why |
|---|---|
| `app` and `dmg` bundle targets, `icons/icon.icns`, `Info.plist` with `NSMicrophoneUsageDescription` | Mac packaging; voice needs a microphone usage string |
| Login-shell `PATH` and settings for the service | Finder/Dock launches can find installed CLIs; after two seconds an unresponsive shell falls back to the inherited PATH plus common CLI folders. The same bounded probe also imports `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `OPENCODE_CONFIG(_DIR)`, `XDG_CONFIG/DATA/STATE/CACHE_HOME` and `LANG`/`LC_ALL`/`LC_CTYPE`, only when the launch environment lacks them; `LANG` defaults to `en_US.UTF-8` when no locale is set. API keys are not imported (`launchctl setenv` is the manual override) |
| `mac_key.rs`: ⌃⌥⌘Space recall shortcut (`tauri-plugin-global-shortcut`), shared with the Win-key setting | macOS counterpart of the Win-key recall. ⌃⌥Space was dropped because it is macOS's "Select next source in Input menu" |
| `RunEvent::Reopen` brings both windows back | Closing a window only hides it; a Dock click must restore it |
| Native file drag-out enabled on macOS (`drag` crate) | Drag files from Workspace to Finder and other apps |
| Show in Finder uses `open -R` (also for packages such as `.app` folders) | Finder selects the file instead of only opening its folder, and a package is selected rather than launched |
| Move to Trash uses `NSFileManager` | No Finder Automation prompt and no sound; Finder may not offer **Put Back** for these items |
| Downloads from the webview are saved to `~/Downloads` and selected in Finder | WKWebView otherwise cancels them |
| Menu-bar icon is a template image | It follows the light or dark menu bar |
| **Chats** menu with Chat 1–9 on ⌘1–⌘9 | The WKWebView never receives ⌘+number, so tab switching lives in the menu (as in other Mac apps) |

### Packaging (`desktop/prepare.mjs`, `scripts/fix-pty-permissions.mjs`)
- Homebrew's `node` is a launcher linked to `libnode.dylib` and cannot run from the bundle
  (the service crashed with `Library not loaded: libnode.*.dylib`). On macOS any Node that
  links libraries outside macOS (Homebrew `libnode`, or a Homebrew/MacPorts build linking
  `/opt/...` libraries) is replaced: the build downloads the official self-contained Node of
  the same version from nodejs.org,
  verifies its SHA-256 against `SHASUMS256.txt`, caches it in `.cache/node-download` and
  bundles that. The copy is made writable, so rebuilds can replace it.
- npm unpacks node-pty's `spawn-helper` without the execute bit; every terminal then fails
  with `posix_spawnp failed`. It is fixed after `npm install` (postinstall) and in the bundle.
- The bundled Node sets the real minimum macOS version: Node 23 and newer need macOS 13.5.
  `./setup.sh desktop` raises `LSMinimumSystemVersion` to match; a plain
  `npm run desktop:build` only warns. Build with Node 22 to support macOS 11–13.4.

### Service (`desktop/service/`)
- Tailscale CLI inside `Tailscale.app`; Claude Code's managed MCP file at
  `/Library/Application Support/ClaudeCode/managed-mcp.json` (Linux: `/etc/claude-code/`).
- Dropped paths in a shell are quoted the POSIX way (`'\''` for an apostrophe); PowerShell keeps `''`.
- Platform-neutral error texts (no "Windows"/"Explorer" on other systems).

### Interface (`src/`)
- `src/desktop/platform.ts`: one place for platform conventions.
- Shortcuts use ⌘ on macOS (⌘⇧T/P/H/W, ⌘1–9); Ctrl+Tab still cycles.
- Terminals: ⌘C/⌘V copy and paste; Ctrl+C reaches the CLI (as in Terminal.app);
  Option+drag selects text while an agent captures the mouse; SF Mono/Menlo fonts.
  Option types your layout's characters; **Use Option as Meta key** in Settings > Chats (macOS only,
  stored as `terminalOptionMeta`) sends Meta shortcuts instead.
- Finder/Trash/macOS wording instead of Explorer/Recycle Bin/Windows; Settings shows the
  ⌃⌥⌘Space shortcut. In the Files rail ⌘⌫ moves the selection to the Trash.
- WebKit fixes: the voice release request uses `keepalive` (WebKit cancels requests from a
  closing page); report iframes are only touched when same-origin; phone recordings are stored
  in IndexedDB as bytes, not Blobs (Safari Private Browsing).

### Scripts
`setup.sh` (macOS/Linux counterpart of `Setup.ps1`), `Start Mr. Mak.command`
(counterpart of `Start Mr. Mak.cmd`), `scripts/check-macos-native.sh`.

## Verification

| Suite | How | Result |
|---|---|---|
| UI suites (8) + preview/template checks | Playwright, headless; **WebKit** by default on macOS (`desktop/service/test/browser.mjs`), also Chromium | 20/20 pass |
| Service tests | `npm run desktop:test` | 90 pass, 0 fail, 2 skipped |
| Rust tests | `cargo test` in `src-tauri` | 2/2 |
| Template checks | `npm run test:template` | 9/9 |
| Native checks | `scripts/check-macos-native.sh` (Accessibility; needs the screen ~30 s) | Chats menu, ⌘1/⌘2, menu switch, ⌘⇧W, Dock reopen, recall shortcut: all pass with the earlier ⌃⌥Space; the script now sends ⌃⌥⌘Space and has not been rerun |
| Manual, on the release app | — | macOS labels; dropping a path with an apostrophe + `ls`; Show in Finder (folder and file); drag a file out to Finder; drag a file into a terminal |
| Manual, still to run after the 0.5.1 fixes | — | On a Retina display, drop a file onto the top ~100 px of a Chats terminal (it must attach) and onto the History or voice overlay (it must not); press Download in the image lightbox (the file must appear in `~/Downloads`); Show in Finder on a `.app` folder selects it instead of launching it |

The UI tests now run in the engine of each platform's app (WebView2/Edge on Windows,
WKWebView/WebKit on macOS); `MRMAK_TEST_BROWSER=chromium|webkit|msedge` overrides.
Run `npx playwright install webkit` once after `npm ci` (as the macOS CI job does) before
`npm run desktop:test:ui`, `npm run test:preview` or the template UI check; `chromium`
needs `npx playwright install chromium`. Several tests needed engine-aware fixes (platform
copy keys, WebKit clipboard permissions, a prototype-level microphone stub, server-side
"lost reply" simulation because Playwright's WebKit cannot route service-worker requests,
and two timing races).

## Known limits / not tested
- Ad-hoc signed only, Apple Silicon only (`aarch64`); no notarisation. An Intel or universal build needs
  `--target universal-apple-darwin` and both Rust targets.
- The Live voice coordinator needs `OPENAI_API_KEY` in the ignored `.env`.
  Dictation can use optional local Whisper instead. The real microphone permission
  prompt was not exercised in the contributor's native checks.
- Mobile access over Tailscale was only tested in automation (WebKit = iPhone Safari's engine),
  not with a real phone.
- The tray (menu-bar) menu is not reachable through Accessibility, so it is not in the native checks.
- `rust-objcopy` cannot strip the release binary on this toolchain (harmless warning).
