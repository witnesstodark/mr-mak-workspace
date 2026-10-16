# Getting started

Mr. Mak is a local desktop workspace for working with several agents. Its files
are ordinary project files, and its chats are ordinary CLI sessions. You can
keep using the same agents outside the app.

**Required before setup: Codex CLI, Claude Code CLI or OpenCode, installed and
configured with your own account.** Use at least one to guide the setup below.
The optional voice coordinator requires Codex specifically; Kimi is another
available terminal integration.

## Choose a folder

Create a repository from the GitHub template and clone your copy. The selected
folder must contain `workspace/workspace.json`. Keep the application source and
your project content together at first; this makes setup and agent handoffs easy.
The template has no previous owner's projects, accounts or conversation history.

## Install the desktop app

On Windows x64, use the installer in GitHub Releases. It bundles the Node
runtime and local service and installs for the current Windows user. WebView2
is installed by its bootstrapper if needed. No administrator terminal is needed
for ordinary app use.

Run **Start Mr. Mak.cmd** from the cloned folder. The app remembers the selected
repository. It opens Workspace and Chats as separate windows with separate
taskbar identities. Closing a chat saves it to History; restoring its full
conversation also relies on that CLI's native session files.

## Connect one agent

Install at least one required CLI using its current official instructions for
your operating system:

- [Codex CLI](https://developers.openai.com/codex/cli)
- [Claude Code](https://code.claude.com/docs/en/setup)
- [OpenCode](https://opencode.ai/docs/)

[Kimi Code CLI](https://moonshotai.github.io/kimi-cli/en/) is available as an
additional terminal integration after the base setup.

Finish the CLI's sign-in flow with your own account. In Chats, press **+**, choose
the provider and a descriptive English title. Start with a task such as
`Dream Game Plan`. Choose the repository as the working folder. The normal CLI
permission flow is enabled by default; bypass is a deliberate per-chat choice.

New Codex and Claude chats default to `xhigh` reasoning effort. Saved effort
choices stay with existing chats. Web links in terminal output open in your
default browser with a click.

Try: “Read the My Dream Game example and turn it into a small project plan for
my game. Ask me for the missing game idea before replacing the example.”

## Subscriptions, API keys and OpenCode

Claude Code can use a Claude Pro or Max login. Codex can use an eligible ChatGPT
subscription login. You do not need to add an API key to Mr. Mak for those chats:
it starts the real installed CLI and keeps its normal authentication and limits.
See [Claude authentication](https://code.claude.com/docs/en/authentication) and
[Codex authentication](https://developers.openai.com/codex/auth).

For OpenCode, install and configure it first using its own provider setup. Check
that `opencode` runs from a terminal, then choose **+ > OpenCode** in Mr. Mak.
Your chosen provider determines authentication and billing. A native Claude Code
subscription does not automatically provide access through third-party clients.

OpenCode chats support History, pinned tabs, files and clipboard screenshots.
The app observes native session events to keep the correct conversation ID;
your native OpenCode data must remain available for resume. Keep one conversation
per Mr. Mak tab. Use a new tab for a new task. OpenCode controls its model and
reasoning settings. Auto-approve is off by default, and explicit deny rules still
apply when it is enabled.

OpenCode 1.x and 2.x use different plugin APIs. Mr. Mak selects the corresponding
small session observer at launch, without writing global configuration. OpenCode
2.x runs a private server for each terminal so tab histories stay separate.
The MCP inspector currently lists Claude, Codex, Kimi and Cursor configurations;
use OpenCode's native MCP controls to inspect its own connections.

## Explore the examples

The pinned game card is a project hub. Research is a readable report with source
links. Dev contains this guide and customization ideas. Image Gen shows the
Arachne design iterations and motion references. All are marked as samples so
they do not vanish into the time-based archive. Archive them when you no longer
need them. Archive changes metadata; it does not delete their media files.

Use Files to inspect `projects`, `inbox`, `knowledge`, `processes` and the skill
folders. A Markdown file opens in Preview; switch to Edit and Save to change it.
The Help button opens a quick guide without creating a new chat.

## Optional voice

Copy `.env.example` to `.env` and add your own `OPENAI_API_KEY` to enable the
OpenAI Live connection. Never commit that file. Sign in to Codex for the
coordinator. Its model follows your account configuration; an optional
`MRMAK_COORDINATOR_MODEL` overrides it. Model access depends on your account.

Voice requests can focus a chat, inspect a report, update a card or hand a larger
task to a worker. Direct actions stay quick; a visible worker handles deliverables.
Task-specific voice requests can use medium, high or xhigh effort. A direct
request to open a new chat uses the same `xhigh` default as the **+** button.
Max requires an explicit request. The app reports tool results before calling
an action complete.

CLI account billing and OpenAI voice API billing are separate. No API generation
is needed to browse the samples or use a signed-in CLI. Optional dictation into
terminals is described in [voice dictation](../knowledge/voice-dictation.md).

## macOS

On an Apple Silicon Mac, download the macOS `.dmg` from
[GitHub Releases](https://github.com/witnesstodark/mr-mak-workspace/releases/latest),
or build the app once from source (about five minutes). To build, install
Node.js 22.20+, [Rust](https://rustup.rs) and the Xcode Command Line Tools
(`xcode-select --install`), then run:

```bash
./setup.sh check      # report prerequisites
./setup.sh desktop    # build Mr. Mak Workspace.app and a .dmg
./setup.sh preview    # optional: browser-only report preview (Node and npm only)
```

Drag `Mr. Mak Workspace.app` to Applications, from the opened `.dmg` or from
`src-tauri/target/release/bundle/macos/`, then double-click
**Start Mr. Mak.command** in the cloned folder. The build bundles a
self-contained Node runtime, so a Homebrew Node is fine.

The app is signed ad hoc but not notarised. A copy you build yourself opens
without a Gatekeeper prompt. If macOS blocks a downloaded copy, open System Settings >
Privacy & Security and choose **Open Anyway**. If it reports the app as damaged,
remove the download quarantine once:

```bash
xattr -dr com.apple.quarantine "/Applications/Mr. Mak Workspace.app"
```

To update a source build, follow the [macOS update steps](updating.md#macos-source-build).
**Start Mr. Mak.command** warns when the build folder holds a newer app than
Applications and prints the replace command; after a normal launch its Terminal
window closes itself.

Differences from Windows:

- Shortcuts use ⌘ instead of Ctrl (⌘⇧T new chat, ⌘⇧P find, ⌘⇧H history,
  ⌘1–9 switch chats, also in the Chats menu; Ctrl+Tab still cycles). In terminals ⌘C/⌘V copy and paste,
  and Ctrl+C reaches the CLI as in Terminal.app.
- Settings > Shortcut: **⌃⌥⌘Space** brings back the windows from any app (the
  Win-key equivalent). Clicking the Dock icon also restores closed windows.
- Both windows share one Dock icon; the menu-bar icon offers Show Workspace,
  Show Chats and Quit.
- The first voice recording asks for microphone access.
- In terminals, Option types your keyboard layout's characters (such as @ or
  #); Settings > Chats > **Use Option as Meta key** turns Option into a Meta key.
- Optional local dictation and Read aloud need Python 3.12 called as
  `python3.12`; see [local voice setup](mobile-access.md#local-voice-setup-on-the-computer).
- `./scripts/check-macos-native.sh` checks the native parts (menus, shortcuts,
  Dock reopen, ⌃⌥⌘Space) through Accessibility; it needs the screen for ~30 s.

Details of the port, verification and known limits: [macOS notes](macos.md).

## Build from source

From a fresh clone, `npm ci` installs both the frontend and local desktop
service dependencies. Then `npm test` runs the service checks; no separate
service install is needed. If you disable npm lifecycle scripts, run
`npm --prefix desktop/service ci` explicitly before tests or the service; on
macOS, also run `node scripts/fix-pty-permissions.mjs` so terminals can start.

Install [Node.js](https://nodejs.org/en/download), Rust's MSVC toolchain and
[Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows):
Microsoft C++ Build Tools and WebView2. Node.js 22.20+ is required by this template.

```powershell
powershell -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Check
powershell -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Desktop
```

On macOS and Linux, `./setup.sh check` and `./setup.sh desktop` do the same
(see [macOS](#macos)).

Check only reports prerequisites. Desktop installs project dependencies and
builds an installer in `src-tauri/target/release/bundle/nsis`. It does not install
or restart the app for you. An agent should prepare updates, then ask before
interrupting active chats with an install or restart.

```powershell
powershell -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Update
```

Run Update in a separate Windows PowerShell window opened from Start, outside
Mr. Mak. An updater inside a managed chat would stop when you quit the app;
Setup detects that case before building. Update waits for you to quit from the
tray, checks that the bundled service has exited, installs the build silently
and opens the same repository again. Finish active chats before quitting.
The registered installation folder is reused. Pass `-InstallDirectory 'D:\Apps\Mr. Mak Workspace'`
if you need to choose it explicitly. The update never terminates your chats itself.
Update mode is Windows-only; on macOS, follow the
[macOS update steps](updating.md#macos-source-build).

For a report-only browser preview, only Node.js 22.20+ and npm are needed beyond
the CLI prerequisite above. **Rust, Cargo and C++ Build Tools are not required
for Preview or the downloaded Windows installer.** They are needed only to
compile the desktop app from source.

```powershell
powershell -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Preview
```

On macOS or Linux:

```bash
./setup.sh preview
```

That starts Vite and links `public/workspace` to the real Workspace folder.
It does not start managed terminals or the voice service.

## On another computer

Clone your own repository, install the app, select the folder and sign in to
your CLIs again. Recreate `.env` locally. Content travels through Git; credentials,
local app state and native CLI histories do not. A fresh clone cannot recover
conversations whose native history exists only on the previous computer.
