# Desktop architecture

The desktop app is a Tauri 2 shell around two webviews. It starts one local Node
service, binds it to loopback and gives each window the authenticated local URL.
Workspace renders the React UI and report files. Chats renders real PTYs through
xterm.js. The windows share sessions and settings but minimize independently.

| Path | Responsibility |
| --- | --- |
| `src/` | React Workspace, document previews, files, chat and voice UI |
| `desktop/service/` | HTTP/WebSocket service, PTYs, session history, tools, voice connection |
| `src-tauri/src/` | Cross-platform shell integration plus Windows taskbar identities, macOS login-shell PATH and key handling, native drag and optional system shortcut |
| `workspace/workspace.json` | Card registry |
| `workspace/_shared/` | Report CSS, image viewer and Help |
| `.mrmak/` | Local runtime state; ignored by Git |

`npm run desktop:build` runs `desktop/prepare.mjs`, builds the React frontend,
packages the service with a Node executable and production dependencies, then
builds the Tauri executable and platform installers. On Linux, use
`npm run desktop:build:appimage` for the distributable AppImage. The recipient
selects their own repository; its content is served from disk rather than baked
into the installer.

The service runs CLIs as the current user. Their available files and permissions
follow their launch options and native account settings. Permission bypass is
off by default. Do not expose the local service as a public web server.

The optional voice frontend uses OpenAI Live. Routine actions call local tools;
the Codex app-server coordinator handles broader orchestration with the user's
configured model. Larger execution tasks go to visible worker terminals. The
provider's native conversation ID is recorded when available for later resume.
Codex discovery checks both local and UTC date folders, keeps waiting through
delayed first prompts, and reads bounded metadata records larger than one small
buffer. Closing or resuming a tab can recover a missing ID from its exact Mr. Mak
origin marker. Shared working directories alone are not proof of ownership.

New Codex and Claude chats default to `xhigh`; explicit saved effort choices are
preserved. Terminal URLs and OSC 8 links use xterm link handlers. New-window
requests from both app windows open HTTP(S) links in the system default browser
(the Windows shell association, `open` on macOS, `xdg-open` on Linux), while the
current app view stays open.

## Projects and the Conversation view

New chat lists recent projects from `recent-projects.mjs`: the Workspace, pinned
favorites, folders recorded in Claude Code's `.claude.json` (`CLAUDE_CONFIG_DIR`
is respected), Codex session metadata from the latest 60 day folders (`CODEX_HOME`
is respected) and the folders of earlier Mr. Mak chats. Only folder names are read
from those files. Worktrees, scratch folders, the Codex app's dated folders and
missing folders are skipped. Pins are saved in `settings.pinnedProjects`. A phone
may start a chat only in a listed folder. The voice coordinator uses the same list
through `list_projects`.

Claude and Codex chats can switch between Terminal and Conversation. Conversation
reads the same native transcript as the phone, sends a prompt through the PTY with
bracketed paste and Enter, and serves media through short-lived `/media/` grants
bound to one chat. A new chat opens in Terminal until it has a conversation, since
the CLI may first ask about folder trust or sign-in. The last chosen view becomes
the default for other chats.

`terminal-prompt.mjs` recognizes a numbered CLI menu with one selected option at
the bottom of the terminal screen. Conversation shows it as buttons. An answer
names the menu it saw; the service re-reads the screen, rejects a changed menu,
then sends arrow keys and Enter one key at a time. Local links in messages open a
Workspace preview, resolved against the chat folder. Desktop Read aloud uses the
same local voices as the phone.

## Fresh-chat handoff and project tabs

`settings.handoffAfter` (default 40, 0 turns it off) is the number of the user's
own messages after which a Claude or Codex chat offers a fresh chat. The count
comes from the native transcript. "Later" and "Not for this chat" are stored per
chat in the window's local storage. Accepting runs `handoff.mjs`: it sends a fixed
handoff request through the PTY, waits for the native turn completion, takes the
reply from its `# Handoff` heading and saves it in `inbox/handoffs/` (ignored by
Git). The new chat uses the same agent, folder, permission and effort settings and
receives one first-message argument naming that file. Claude also receives
`--add-dir` for the handoff folder. Nothing changes in the original chat.

`settings.groupTabsByProject` groups open tabs by working folder. A group keeps
the position of its first tab; tabs reorder only within their project.

Fullscreen Claude scrolls its own conversation. Terminal snapshots preserve
both mouse tracking and the requested SGR encoding, including saved screens,
so switching tabs or reconnecting does not disable its mouse wheel. Classic
Claude and Codex continue using local terminal scrollback.

## Local microphone dictation

Desktop chats, the Mak composer and paired mobile chats support free local Whisper
dictation. Follow [setup and review behavior](../docs/mobile-access.md#voice-input).
The local engine is the default. Choose Free/Paid/Off in the top-right phone
button (**Phone settings**) or **Settings → Speech-to-text**. The choice is saved
and shared with paired phones. Paid providers require an API key on the computer.

## Workspace and Chat themes

Settings → Appearance offers independent **Workspace theme** and **Chat theme**
choices. Chat also has an Appearance button in its header. Thirteen named palettes
are available, alongside Dark, Light and System. **Codex / ChatGPT**,
**Antigravity** and **Claude Code** take visual inspiration from those tools;
they are not exact copies. The other five families each offer a light and dark option:

| Family | Light | Dark |
| --- | --- | --- |
| Nordic | Fjord | Polar Night |
| Forest | Botanical | Moss & Brass |
| Sandstone | Clay | Desert Night |
| Ocean | Sea Glass | Harbor |
| Plum | Orchid Paper | Velvet |

Existing family preferences select Fjord, Moss & Brass, Clay, Harbor and Velvet
respectively. Both approved variants are selectable by their family and name.

Selections are saved and synchronised across open windows. Workspace also themes
standard reports; custom artwork and games retain their colours. Chat themes apply
to Conversation and Terminal without restarting a CLI or losing a draft. Terminal
text has a minimum contrast ratio of 4.5; Original and Focus remain separate choices.

## Terminal appearance

Settings → Chats → Terminal appearance offers **Original CLI colors** (the default)
and **Mr. Mak Focus** (muted colors). Original preserves CLI diff colors for added
and removed lines. The choice is saved for all desktop chats and applies to open
terminals immediately without restarting sessions. Existing saved preferences
are retained. The same choice is available in each chat’s options menu.

## OpenCode terminals

The service detects installed OpenCode 1.x or 2.x and launches its real TUI.
OpenCode owns model choice, provider authentication and reasoning configuration.
The optional `--auto` flag keeps OpenCode's explicit permission denials intact.

`desktop/service/opencode/` contains dependency-free event observers for both
plugin APIs. A per-process inline configuration adds the matching observer while
preserving configured plugins, models and providers. No global config is edited.
OpenCode 2.x uses `--standalone` to isolate the server for each managed terminal.

Observers save only a native session ID, launch identity and activity/completion
metadata under `.mrmak/`. They do not save prompts or provider credentials.
Root-session identity is captured from an actual native event, not inferred from
a shared working directory. Resume passes `--session` with that recorded ID.
A launch-specific marker prevents stale events from changing a new terminal's
activity. Native CLI history must remain on disk for conversation restoration.

## Checks

```powershell
npm ci
npm run lint
npm test
npm run test:template
npm run build
npm run desktop:test:ui
npm run test:preview
```

The same commands run in zsh or bash on macOS and Linux.

The root install also installs the locked `desktop/service` dependencies. If
you deliberately use `npm ci --ignore-scripts`, run
`npm --prefix desktop/service ci` before tests or the local service, and on
macOS also `node scripts/fix-pty-permissions.mjs`: npm can unpack node-pty's
`spawn-helper` without the execute bit, and terminals then fail with
`posix_spawnp failed`.

UI tests use an isolated repository and fake terminals. They run in the engine
of each platform's app: Edge (WebView2) must be available on Windows; on macOS
they use Playwright WebKit (WKWebView), so run `npx playwright install webkit`
once after `npm ci`, as the macOS CI job does. Set `MRMAK_TEST_BROWSER` to
`msedge`, `chrome`, `chromium` or `webkit` to override; `chromium` and `webkit`
need `npx playwright install <name>` first. Live voice and subscription smoke
checks are separate scripts with explicit opt-in flags; they are never part of
the default test command.

OpenCode has a separate no-account integration test against a local mock model:

```powershell
node desktop/service/test-opencode-native.mjs --binary C:\path\to\opencode.exe --tui
```

On macOS or Linux:

```sh
node desktop/service/test-opencode-native.mjs --binary "$(command -v opencode)" --tui
```

It isolates the CLI's home and data directories, verifies two separate native
histories, then closes and resumes a real terminal. Tested with OpenCode 1.18.3
and 2.0.21 on Windows. No paid model calls are made.

Windows x64, Linux and macOS are supported native targets. The macOS app is
ad-hoc signed (not notarised) and Apple Silicon only; build steps and limits are in
[docs/macos.md](../docs/macos.md).

Read aloud uses fixed, free local voices: Michael (US man) and Emma (UK woman).
Run `powershell -ExecutionPolicy Bypass -File scripts/setup-local-read-aloud.ps1`
on Windows once. On macOS, run `brew install python@3.12`, then
`python3.12 scripts/setup-local-voice.py read-aloud`; on Linux, use any
Python 3.10-3.12. See
[local voice setup](../docs/mobile-access.md#local-voice-setup-on-the-computer).
Models and the CPU Python environment stay under the ignored
`.cache/read-aloud` folder; no cloud speech key or paid account is needed.
Phone settings stores the voice choice. The mobile service lazily starts its
own voice worker and releases it after idle time; updating service files requires
a user-approved application restart.
