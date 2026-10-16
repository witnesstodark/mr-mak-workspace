# Update an existing Workspace

The application and your project folder are separate. The Windows installer
(or, on macOS and Linux, a fresh build) updates the app and its local service.
It does not replace your cards, skills, context, credentials or agent
conversations.

## Application

1. Finish active agent tasks, then choose Quit from Mr. Mak's tray menu.
2. Install **Mr. Mak Workspace 0.5.1** for Windows x64.
3. Open the same repository you were using before. Your cards, settings and
   History remain in that folder.

For a desktop build from source, run `Setup.ps1 -Mode Update` in an external
Windows PowerShell window opened from Start, outside Mr. Mak. It replaces these steps:
it builds the current source, waits for you to quit Mr. Mak, installs the build
silently and starts Mr. Mak again. See [getting started](getting-started.md).
Update mode is Windows-only.

### macOS (source build)

macOS has no installer or Update mode. Run these steps in Terminal, outside
Mr. Mak, from your repository folder:

1. Merge the source changes, for example with `git pull`.
2. Run `./setup.sh desktop`. Mr. Mak can stay open while it builds.
3. Finish active agent tasks, then choose **Quit Mr. Mak and stop terminals**
   from the menu-bar icon.
4. Replace the installed app with the new build:

   ```bash
   rm -rf "/Applications/Mr. Mak Workspace.app"
   ditto "src-tauri/target/release/bundle/macos/Mr. Mak Workspace.app" "/Applications/Mr. Mak Workspace.app"
   ```

   The build is already signed ad hoc. Only if macOS still will not open the
   copy, sign it again: `codesign --force --deep --sign - "/Applications/Mr. Mak Workspace.app"`.
5. Double-click **Start Mr. Mak.command**. It prefers the copy in Applications,
   so skipping step 4 starts the old version; it warns when the build folder
   holds a newer app and prints the replace command from step 4.

With a downloaded `.dmg` instead, quit Mr. Mak the same way, drag the new app
from the disk image over the one in Applications and choose Replace.

macOS asks again for permissions such as microphone access after each rebuild,
because the ad-hoc signature changes. See [macOS notes](macos.md).

The 0.5.1 source update preserves your selected dictation provider, custom model
and terminal appearance. Fresh setups default to local Whisper, which requires
the optional [local voice setup](mobile-access.md#local-voice-setup-on-the-computer).
OpenAI and OpenRouter remain explicit paid choices; a missing local model never
causes an automatic cloud request. New mobile media previews, report-position
restore and desktop dictation are included alongside the macOS port.

Version 0.5.0 adds optional [mobile access](mobile-access.md). After updating,
use the phone button in Chats to connect your own devices through Tailscale.
Existing pairings survive application updates. Mobile dictation uses an
OpenRouter or OpenAI transcription key on the computer; typed messages use
your existing CLI account. Long links and paths stay within mobile chat cards.
The Linux AppImage also includes a launcher permission fix.

The History fix can reconnect a Codex conversation whose original native record
still exists but whose ID was not saved by Mr. Mak. If that native history was
deleted or belongs to another account, the update cannot recreate it. Use
New chat > Resume with a known native ID when importing an existing CLI chat.
Saved terminal screens are retained when automatic recovery is not possible.

Version 0.4.18 adds Linux packaging and project/knowledge-provider foundations.
Windows keeps its native terminal behavior and existing account sign-ins.
No external integration is connected automatically.

Version 0.4.17 added **Settings > Appearance > Workspace theme**. Choose Light
for dark text on white, or System to follow your device. Dark remains the default.
Standard HTML reports follow this preference. For a report with an independent
visual design, merge its updated source or add `data-mak-theme="custom"` to the
root element to preserve its palette. See [customization](customization.md).

Version 0.4.16 added **OpenCode** to New chat, History and the default-agent
setting. Install and configure OpenCode separately, then reopen Mr. Mak if the
command was just added to PATH. Existing Codex and Claude chats keep their login
and settings. No API key is needed for their subscription-backed CLI chats;
voice remains optional and uses a separately billed OpenAI API connection.

## Skills and source

For a browser-only preview, merge the source fixes, stop your Preview server,
then run `Setup.ps1 -Mode Preview` (macOS/Linux: `./setup.sh preview`) and
reload the browser. Setup runs `npm ci`
and starts Vite. Rust is not required for this mode. Root `npm ci` also installs
the local service dependencies.

The latest source includes a follow-up to the 0.4.15 preview fix: a shared
stylesheet could prevent the card viewer from loading after normal setup.
Direct HTML links still worked in that case. Updating the source fixes the
embedded viewer; downloading an installer alone does not update Preview.

An installer alone cannot add the new skills. For a clone that tracks this
repository, ask your agent to review and merge the release's source changes.
Keep local work committed or backed up, resolve conflicts deliberately, and
preserve your own `workspace/workspace.json`, cards, context and connections.
Do not reset a customized repository to the template to obtain an update.

For a template-derived repository with unrelated history, use the separate
**Mr-Mak-Skills-0.4.14.zip** for the workflows. Extract it outside your project,
read `SKILLS-README.md`, then merge the desired folders. No personal projects,
keys, CLI logins or MCP definitions are included. The pack does not replace your
`AGENTS.md` or `CLAUDE.md`.

The maintained skills live in `.agents/skills`; complete Claude copies live in
`.claude/skills`. Keep both in sync if you use both agents. Dependencies are
listed in [the skill index](skills.md) and in each skill. A configured Codex CLI, Claude
Code CLI or OpenCode remains required; optional providers use your own credentials.

If building the desktop from source, rebuild after merging application changes.
Use the [setup guide](getting-started.md) for the prerequisites.
