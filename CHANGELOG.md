# Changelog

## 0.6.1 - 2026-10-24

- Reduce unnecessary drawing in the sidebar logo and 3D viewer. Static models stop submitting frames, while camera controls, shading changes and restored graphics contexts still repaint.
- Update the Rust toolchain action to the reviewed commit pin.
- MCP lists the servers of Claude plugins that claude.ai syncs to the signed-in account (for example PDF Viewer), with the same on/off state Claude Code uses. claude.ai connectors are not stored on the computer, so the panel points to `/mcp` in a Claude chat for them.
- An empty MCP configuration file, as Antigravity creates before a server is added, no longer shows a read error in MCP.
- Add independent Workspace and Chat themes with thirteen named palettes: Codex / ChatGPT, Antigravity, Claude Code, and light/dark variants of Nordic, Forest, Sandstone, Ocean and Plum. Saved choices sync across windows and apply to standard reports, Conversation and Terminal without losing drafts or reconnecting the CLI. Reading text and action labels maintain at least 4.5:1 contrast.

- Restrict desktop HTML and SVG previews to the selected report folder, with expiring access and an opaque sandbox. Keep local report assets, theme changes and external links working.
- Keep desktop window credentials in memory, with native reload recovery. Bundle Inter and Fraunces locally so the app UI does not request Google Fonts.
- Limit phone pairing attempts per source, invalidate repeatedly guessed codes, and expire phones after 30 idle days.
- Enforce the selected permission default when the coordinator sends to or reopens an existing bypass chat.
- Preserve typographic apostrophes as literal text in Windows command shims and pasted shell paths.
- Refresh six service dependency versions to clear the current npm audit findings.
- Read optional mesh-generation credentials from the Hugging Face login or environment, and update the video downloader minimum version. The Linux glib dependency advisory remains an upstream follow-up, documented in SECURITY.md.

## 0.5.2 - 2026-10-18

- Group chat tabs with named, coloured headers. Drag or collapse a group, manage it from a tab's right-click menu, and find groups in History. Deleting a group keeps its chats. Pinned tabs retain their separate order.
- Add an optional Conversation view for Claude Code and Codex, with Markdown, images, attachments, dictation, local file previews, read aloud and command completion. Terminal remains available for native CLI controls. Double-click or press F2 to rename a tab.
- Answer CLI menus in Conversation with one-use approvals bound to the current process and full visible prompt. Changed commands, repeated submissions and changes during menu navigation are rejected.
- Edit sent Claude messages through its native rewind. Full message labels must match exactly; ambiguous shortened labels require choosing in the terminal.
- Clear sent command drafts before switching to Terminal, so returning to Conversation cannot restore a command that was already delivered.
- List recent projects in New chat, pin favourite folders and filter History by project. Paired phones can select listed folders. Optional fresh-chat suggestions save a handoff and continue with the same agent and permission settings.
- Read Codex 0.163 completed-item transcripts and follow native rewinds or `/new`. Use `--no-daemon` when supported so each terminal stays linked to its conversation. Show the active model and compact CLI/background-agent events.
- Mobile Terminal defaults to wrapping text, with Fit and Actual modes available. Add Workspace pull-to-refresh and Android Chrome/Edge back navigation. Preserve report positions without replaying a stale restore on fragment navigation.
- Improve macOS keyboard layouts, Option/Meta settings, clipboard, Retina drag/drop, downloads, Finder/Trash operations, recall shortcuts, CLI paths and process cleanup. Validate bundled Node and ad-hoc app signatures. Developer ID signing and notarization are not included.
- Improve macOS setup documentation and local voice installation. Preserve accented Whisper transcripts on Windows.
- Reset alternate-screen and mouse-capture modes before restarting a CLI; let Claude exit gracefully before the bounded hard-stop fallback.
- Accept quoted Windows installation paths when updating.
- Update five official GitHub Actions at verified commit pins. Keep release dependency jobs read-only, without persisted checkout credentials or automatic npm caching.

## 0.5.1 - 2026-10-14

- Add Antigravity CLI chats with Google sign-in, reasoning effort, per-chat native history recovery and MCP inventory. Install `agy` separately, then choose it in New chat. Model access remains controlled by Google.
- Harden release jobs: build with read-only tokens and no saved Git credentials, separate dependency checks from tag publication, pin Actions to full commit hashes and disable npm caches in release workflows. Dependabot tracks the pinned Actions.
- Update the optional img2threejs vision environment to Transformers 5.10.0. Pin Hugging Face model revisions and verify MediaPipe downloads with SHA-256, including cached files.
- Validate conversation IDs and voice coordinator chat options on the server. Read malformed HTML reports without repeated backtracking.
- Launch native Windows CLI executables directly, avoiding the encoded PowerShell wrapper that triggered the reported Norton block. Command scripts still use the full PowerShell path.
- Improve macOS support: native app/DMG packaging, Finder and Dock behavior, Command-key shortcuts, drag and drop, microphone permission and a bundled Node runtime. A login-shell timeout keeps launch responsive. CI archives retain executable permissions.
- Start Windows agent chats through the full PowerShell path, even when its folder is missing from PATH.
- Support CLI selection copy through OSC 52 after a foreground selection or Copy gesture. Background output and clipboard read requests are rejected.
- Add `Setup.ps1 -Mode Update` for source builds. Run it in an external PowerShell window; it waits for you to quit, preserves custom installation folders and restarts the same repository.
- Improve mobile navigation and reconnect after sleep. Keep independent chat, report tab and scroll positions, including after reload. A message can reference the current report without attaching its contents.
- Preview and download shared conversation images and videos through paired, scoped access. Images support zoom and pan. Recent activity starts collapsed.
- Add optional local Whisper dictation on desktop and mobile, with one provider setting and recoverable recordings. Desktop dictation inserts text without pressing Enter. Updates preserve existing providers, models and appearance choices.
- Add optional local Read aloud with Michael and Emma voices. Cross-platform Python setup uses pinned model files and SHA-256 checks. No models are downloaded at app startup, and no cloud fallback is automatic.

- Click a card's status dot in the desktop Workspace to set Active, Done or Archived, change its category, or pin it. Changes save immediately; archived cards keep their files and can be restored through search or Show archive.
- Retry card saves when Windows briefly locks the registry, preserving the latest metadata and cleaning up unsuccessful temporary writes.
- Add left/right terminal arrows on phones for CLI menus such as reasoning effort. Keep all keys visible with touch-sized buttons that wrap on narrow screens.
- Close an agent chat from the phone after confirmation. Its desktop tab closes too; the saved conversation stays in History and the phone retains its unsent draft.

Thanks to @pbau3r-sfdy, @serhat1akman and @redDwarf03 for the contributions and reports. Outstanding security work remains tracked separately; this release does not close the full security review.

## 0.5.0 - 2026-10-09

- Resolve Windows short paths and linked repository roots before checking mobile report boundaries; external folders remain blocked.
- Keep mobile chat cards within the screen when previews contain long links or file paths; prevent sideways drift of the chat list.
- Dictate mobile messages with a microphone button, review the transcript before sending, and recover or download recordings after a failed transcription. Optional OpenRouter/OpenAI transcription uses keys on the computer.
- Allow QR scanners to open the mobile connection page, while keeping cross-site API requests, embedded pages and sockets blocked.
- Prepare Linux AppImages with a readable/executable launcher, verify final package permissions and run the bundled Node as a different user before upload. Pin Ubuntu 22.04 for a stable glibc baseline and remove the redundant Linux suffix from AppImage filenames.
- Connect a phone from Chats with a private Tailscale route, a short-lived QR code and desktop approval. View and revoke paired devices in the same panel.
- Read Codex and Claude conversations, use a live terminal view for supported agents, and send messages or images from a mobile web app. Desktop and phone selections stay independent.
- Keep drafts per chat and recover deliveries with persisted message receipts. Opening a phone never changes desktop terminal dimensions.
- Read Workspace HTML and Markdown reports through isolated previews with image enlargement and downloads. Add mobile checks to the shared Claude and Codex authoring skill.
- Update patched source-map-js and smol-toml dependencies.
- Update the MCP SDK to 1.32.1, which includes the OAuth credential issuer fix.

## 0.4.19 - 2026-10-05

- Talk to Mak now accepts pasted screenshots and attached images. Preview or
  remove them before sending; failed requests keep the draft and attachments.
  Codex receives the images as image inputs, and copies stay in your inbox.
- Shift+Enter adds a new line in Talk to Mak. Enter sends the message, and
  text composition with an input method does not submit it accidentally.
- Microphone and message errors can be dismissed. Closing an error does not
  request microphone access again.
- Coordinator-created chats respect the permission level selected in the UI.
  Project MCP connection checks also respect the agent's saved approval state.
- Added optional offline asset delivery manifests from
  [zedarvates](https://github.com/zedarvates) in
  [PR #11](https://github.com/witnesstodark/mr-mak-workspace/pull/11).
  Build a file manifest or verify a delivery's sizes and hashes without an
  account or network request. See the [manifest guide](scripts/asset-delivery/README.md).

**Update:** finish active tasks, quit Mr. Mak, then install the new package.
For a source build, follow the [update guide](docs/updating.md). The optional
manifest tool comes from the repository update. This release addresses #13,
#14 and #15; the taskbar-icon report (#16) and the wider security review (#5)
remain open.

## 0.4.18 - 2026-10-04

- Added Linux desktop packaging and release build automation, contributed by
  [rluders](https://github.com/rluders) in [PR #8](https://github.com/witnesstodark/mr-mak-workspace/pull/8).
- Added a project-adapter foundation with generic and Godot project detection,
  metadata, relevant files and optional editor/run commands when Godot is installed.
- Added optional Markdown knowledge sources with resolved-path boundary checks,
  plus integration-provider foundations. No external account is connected by default.
- Preserved Windows startup with canonical paths and OpenCode version detection,
  command discovery and session recovery during the platform refactor.
- Release assets now use a dedicated staging folder and explicit repository
  selection. The browser check retains card-loading coverage without HMR.

**Update:** quit Mr. Mak after active tasks finish and install the new Windows
package. Existing projects, chat history and settings remain in place. For
Preview or a source build, merge the update and follow [the update guide](docs/updating.md).
Linux packaging is covered by CI; macOS build automation is included but has
not been interactively validated. This release includes the 0.4.17 reading themes.

## 0.4.17 - 2026-10-02

- Added Dark, Light and System in Settings > Appearance. Light uses dark text
  on white across Workspace navigation, Files, Markdown and standard reports.
  Browser Preview also has a Settings button with the same theme choices.
- Theme changes apply immediately, persist after restart and preserve a report's
  scroll position and edits. System follows the device theme. Terminal palettes,
  images and custom game designs keep their own colors.

- Fixed browser preview failing to open every card after the normal setup
  created `public/workspace`. Shared report CSS now goes through the app's
  stylesheet pipeline instead of being requested as a JavaScript module.
- Fixed image dialogs closing immediately in development mode and kept them
  outside Markdown paragraphs, so enlarged images remain usable.
- Removed the Vite `__dirname` warning and clarified that Rust is needed only
  when compiling the native desktop app, not for browser preview.
- Browser checks now run the same workspace-link setup as `npm run dev`, and
  verify card navigation, shared dialog styling and recovery after a failed load.

**Update:** finish active tasks, quit Mr. Mak and install the Windows update.
For browser preview, merge the latest source, stop your Preview server, then
run `Setup.ps1 -Mode Preview` again and reload the browser. Dark remains the
default. Issue #1 stays open for confirmation from the reporter.

## 0.4.16 - 2026-10-01

- Added OpenCode to New chat, History and the default-agent setting. It runs the
  installed native CLI with its own providers, account login and model settings.
- OpenCode conversations keep their native session IDs for close/reopen and app
  restart. Native activity drives the working glow and unread completion marker.
  OpenCode 1.x and 2.x have separate observers; v2 terminals use private servers.
- OpenCode uses the existing tab colors, pinning, file drops, clipboard images,
  copy controls and fullscreen terminal scrolling. Voice can open OpenCode chats.
- Clarified subscription setup in README, Help and the setup guide. Claude Code
  and Codex can use eligible existing subscriptions without an API key. Optional
  voice uses a separately billed OpenAI API connection. OpenCode's selected
  providers determine its own authentication and billing.
- Setup now accepts OpenCode as the primary CLI. Permission auto-approval remains
  off by default; OpenCode's explicit deny rules remain in effect when enabled.

**Update:** finish active tasks, quit Mr. Mak and install the Windows update.
Install and configure OpenCode separately if you want to use it. Existing chats
and project content are preserved. The 0.4.14 skills pack is unchanged.

## 0.4.15 - 2026-09-30

- Fixed browser preview crashing on Markdown cards with links or images. Local
  document paths now resolve against the browser origin. A report error also
  leaves Workspace navigation available, with a reload option.
- Root `npm ci` now installs the local service dependencies too, so tests and
  source-based service startup work without an extra install command.
- Removed window authentication credentials from runtime diagnostics. Startup
  passes them directly to the desktop shell without saving them in the project.
- Updated the service's `fast-uri` dependency to 3.1.8, addressing
  [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj).
- Added browser preview regression checks and a private security reporting guide.

**Update:** finish active tasks, quit Mr. Mak, then install the Windows update.
For browser preview, merge the source update, run `npm ci`, then restart Vite.
The skills pack from 0.4.14 is unchanged. The separate report in issue #5 remains
open while we await its private reproduction details; this release does not
claim to resolve that report.

## 0.4.14 - 2026-09-30

- Added six reusable agent workflows: game VFX, game UI, animation integration,
  level design, game audio and native visual review. Both Codex and Claude get
  complete project-local skills with the same resources.
- Improved Blender animation, motion references, feature handoffs and production
  routing. Added a separate skills ZIP with the supporting files and licences.
- Fixed Codex History recovery across local midnight and UTC date boundaries.
  Conversations with large metadata or a delayed first prompt can be discovered.
  Recovery checks the original conversation's identity rather than guessing from
  a shared project folder.

This release aligns the public and desktop version numbers at 0.4.14; it follows
public 0.1.2. Previous public releases remain available.

**Update:** quit the app after active tasks finish, then install the Windows
update and open your existing repository. New skills are repository content;
merge them separately or use the skills ZIP. See [the update guide](docs/updating.md).

## 0.1.2 - 2026-09-23

- Fixed mouse-wheel scrolling in fullscreen Claude Code chats after opening a tab or returning to it. Scrolling also survives reconnects.
- Terminal snapshots and saved screens now preserve the mouse protocol requested by the CLI. Codex and classic Claude keep their existing scrollback behavior.

**Update:** finish active tasks, quit Mr. Mak Workspace from its tray menu, then run the new Windows installer. Open your existing repository; project files, settings and chat history stay in place.

## 0.1.1 - 2026-09-22

- Web links in agent chats and Workspace cards now open in your default browser. Wrapped terminal links and named citations work too.
- The bottom terminal row stays visible above the connection bar, including the model and reasoning effort.
- New Codex and Claude chats default to `xhigh`. Existing saved effort choices are kept; task-specific voice requests can still select an appropriate effort.

**Update:** finish active tasks, quit Mr. Mak Workspace from its tray menu, then run the new Windows installer. Open it with your existing repository. Your project files, settings and chat history stay in place.

The installer updates the application. It does not replace the sample cards or your repository content. If you build from source, bring in this release's application changes and rebuild; keep your own Workspace files and context.

## 0.1.0

First public release with two connected desktop windows, CLI chats, four sample projects and fourteen shared skills.
