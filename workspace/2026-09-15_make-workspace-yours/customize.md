# Make Workspace yours

## Change in Settings

Use the right-hand Settings rail for the available display and behavior controls.
Terminal text settings and tab colors live with Chats. The Win-key shortcut is
optional: when enabled, a single Win press returns to hidden Mr. Mak windows;
when they are already in view, it opens Start. Win combinations remain normal.
On macOS, the same option is under Settings > Shortcut: its key combination
brings back the windows from any app, and clicking the Dock icon also restores
them. The template leaves it disabled.

Choose chat permission bypass deliberately. Ordinary permissions are the default.
Voice settings can adjust the voice profile, speed and conversation behavior.
Some voice changes take effect on the next voice connection.

## Change with an agent

| Ask for | Where it belongs |
| --- | --- |
| “Remember how I want reports written.” | `context/preferences.md` |
| “Save this reliable modeling method.” | A focused note in `knowledge/` |
| “Make this repeatable.” | A workflow in `processes/` and, if useful, a project skill |
| “Add a report tab to this project.” | The existing card's steps in `workspace/workspace.json` |
| “Create a new research task.” | A dated Workspace folder and one registry entry |
| “Change fonts, colors or spacing everywhere.” | Shared application and report styles |
| “Add another main folder.” | Files rail defaults in the application source |

A useful instruction is: “Read AGENTS.md, propose a small change, implement it,
verify the result, and prepare the update. Ask before restarting the desktop app.”

## A small project structure

Keep one pinned project hub with Brief, Plan and Assets tabs. Put lasting source
files under `projects/<project>/`; keep the pages you read under its Workspace
folder. Add one card for an independent task, not one card per generated image.
Related iterations become tabs in the same card. Mark superseded work archived.

## Optional providers

The template does not install MCP servers globally. Use the MCP panel to inspect
project and global configuration, then follow the provider's current instructions.
For this project, use `.mcp.json` for Claude and `.codex/config.toml` for Codex.
Connection credentials remain local or in the provider's own login store.
Follow the selected client's documented environment-secret support rather than
placing a token directly in a tracked connection file.

For fal.ai, read the bundled `fal-ai-generation` skill, connect the MCP or use its
Python helper, and set `FAL_KEY` in `.env`. Discover the exact model schema before
starting a paid job. Higgsfield uses its own CLI setup and account.

## Design rules

Use the shared dark report style, readable headings and consistent card spacing.
Every report image must open at full size and offer a download. Keep wide tables
scrollable inside the report, and test tabs at narrow window widths. Preserve
the document surface while a tab loads so switching does not flash white.

The Workspace authoring skill contains the maintained rules. If you change the
design system, update that skill and the shared implementation together.
