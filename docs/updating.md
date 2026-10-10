# Update an existing Workspace

The application and your project folder are separate. The Windows installer
updates the app and its local service. It does not replace your cards, skills,
context, credentials or agent conversations.

## Application

1. Finish active agent tasks, then choose Quit from Mr. Mak's tray menu.
2. Install **Mr. Mak Workspace 0.5.0** for Windows x64.
3. Open the same repository you were using before. Your cards, settings and
   History remain in that folder.

For a desktop build from source, `Setup.ps1 -Mode Update` replaces these steps:
it builds the current source, waits for you to quit Mr. Mak, installs the build
silently and starts Mr. Mak again. See [getting started](getting-started.md).

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
then run `Setup.ps1 -Mode Preview` and reload the browser. Setup runs `npm ci`
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
