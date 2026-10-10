# Desktop architecture

The desktop app is a Tauri 2 shell around two webviews. It starts one local Node
service, binds it to loopback and gives each window the authenticated local URL.
Workspace renders the React UI and report files. Chats renders real PTYs through
xterm.js. The windows share sessions and settings but minimize independently.

| Path | Responsibility |
| --- | --- |
| `src/` | React Workspace, document previews, files, chat and voice UI |
| `desktop/service/` | HTTP/WebSocket service, PTYs, session history, tools, voice connection |
| `src-tauri/src/` | Cross-platform shell integration plus Windows taskbar identities, native drag and optional system shortcut |
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
requests from both app windows open HTTP(S) links through the Windows default
browser association, while the current app view stays open.

Fullscreen Claude scrolls its own conversation. Terminal snapshots preserve
both mouse tracking and the requested SGR encoding, including saved screens,
so switching tabs or reconnecting does not disable its mouse wheel. Classic
Claude and Codex continue using local terminal scrollback.

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

## Live Codex sources

The service reads `<stateDir>/live-sources.json` at startup. `stateDir` defaults
to `<repo>/.mrmak/` and can be selected with the service's `--state` option.
This file and all generated output are local, ignored state. Keep personal
project paths out of committed configuration. An absent file means no sources.

```json
[
  {
    "id": "project-codex",
    "label": "Project Codex",
    "project": "<existing absolute project folder>",
    "python": "python",
    "args": ["-B", "Scripts/Docs/build_site.py", "--no-requests"]
  }
]
```

IDs must be unique and match `^[a-z0-9-]+$`. `label` and `python` are nonempty
strings, `project` is an existing absolute folder, and `args` is an array of
strings. Workspace owns `--out`; do not supply it in `args`. The state and
output folders must be outside the source project. Configuration changes take
effect at the next owner-approved service restart.

The builder contract is:

- Workspace launches `python` with the configured argument array, project
  working directory, no shell, a hidden Windows process and a ten-minute timeout.
  It appends `--out <stateDir>/live/<id>` to every invocation.
- A successful build exits zero and writes `index.html` plus relative assets
  into that output folder. The builder must safely replace its outputs and keep
  the previous complete reader on failure. Workspace never edits source files.
- Adding `--list-inputs` returns only JSON on stdout:
  `{"dirs":[{"path":"<absolute folder>","recursive":true,"extensions":[".md",".html"]}],"files":["<absolute file>"]}`.
  Directory extensions filter input events; an empty array accepts all files.
  Single files are watched through their parent so replacement saves work.
  Discovery runs before the first build and again after every successful build.
- Nonzero exit reports stderr's last 2 KB. End diagnostics with the source file
  and line to fix. Keep `--no-requests` in the local Codex configuration and use
  `-B` to prevent Python bytecode writes in the project.

The service builds once on startup, then waits for one second without matching
changes. Processes run one at a time; changes during a build coalesce into one
follow-up after the quiet period. Shutdown stops watchers, timers and builders.
The generated folder is granted to the separate GET/HEAD-only content server.
Authenticated `/api/bootstrap` includes `liveSources`; `GET /api/live-sources`
returns the same status array. Each transition broadcasts a `live-source` event
with a `source` containing `id`, `label`, `state`, `builtAt`, `error` and `url`.
WebSocket reconnects include a fresh snapshot.

Card steps can set `source` to the configured ID and `path` to `index.html`.
The UI resolves the path against the source URL, displays build/failure status
and reloads the existing iframe on success. Origin-checked `mrmak:reload`
messages preserve the hash route and restore window scroll from session storage
after the route renders. The Codex keeps its own interface and CDN dependencies.
Browser Preview cannot run these builders.

Mobile Results resolves a step's `source` through the same initialized
`LiveSources.reportRoot()` used to create its desktop grant. It serves the
existing generated output in place, including output under an external
`stateDir`. The source project itself is never granted. An unknown source is
an error; it does not fall back to the card folder. Steps without `source`,
such as a local guide, continue to use `workspace/<folder>/<path>`.

Live output roots are canonicalized and pinned at startup. Output junctions
cannot redirect them to other folders, and mobile requests recheck the root
and each asset's canonical containment. Mobile preview URLs use a virtual
`live/<id>/` prefix; absolute Windows paths and desktop grants are not sent to
the phone. Each mobile grant still expires after 30 minutes and is revoked
when its device is disconnected.

Mobile reports retain an opaque sandbox and a restrictive CSP. A source that
needs external scripts or fonts can explicitly configure `mobileResources`
in its local `live-sources.json` entry:

```json
"mobileResources": {
  "scripts": [
    "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js"
  ],
  "styles": ["https://fonts.googleapis.com/css2"],
  "fonts": ["https://fonts.gstatic.com"]
}
```

Scripts and styles require exact HTTPS paths; fonts require HTTPS origins.
Credentials, queries, fragments, wildcards and CSP directive injection are
rejected. The policy applies only to that source's grant. It adds no remote
API access or same-origin privileges. Embedded subframes remain blocked;
generated preview links can open full pages within the same grant. Missing
dependencies are reported by the reader; Workspace does not substitute them.
Changes take effect at the next owner-approved service restart.

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

The root install also installs the locked `desktop/service` dependencies. If
you deliberately use `npm ci --ignore-scripts`, run
`npm --prefix desktop/service ci` before tests or the local service.

UI tests use an isolated repository and fake terminals. Edge must be available
on Windows, or set `MRMAK_TEST_BROWSER` to a Playwright browser channel you have
installed. Live voice and subscription smoke checks are separate scripts with
explicit opt-in flags; they are never part of the default test command.

OpenCode has a separate no-account integration test against a local mock model:

```powershell
node desktop/service/test-opencode-native.mjs --binary C:\path\to\opencode.exe --tui
```

It isolates the CLI's home and data directories, verifies two separate native
histories, then closes and resumes a real terminal. Tested with OpenCode 1.18.3
and 2.0.21 on Windows. No paid model calls are made.

Windows x64 and Linux are supported native targets. macOS remains a future target;
the shared platform boundary avoids making Linux behavior a prerequisite for it.
