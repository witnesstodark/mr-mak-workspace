# Mr. Mak agent skills

This pack contains 20 project-local workflows for Codex CLI, Claude Code, and
Cursor Agent. You can use them in a game or creative project without installing
Mr. Mak's desktop app. Sign in to at least one of those CLIs first.

Read `docs/skills.md` for the complete index. The six new game workflows cover
VFX, UI, animation integration, levels, audio and native visual review. Existing
skills cover planning, handoffs, image/3D production, Blender animation, video
inspection, Workspace reports and local dictation setup.

## Add selected skills to a project

1. Extract the ZIP to a temporary folder. Keep your project files where they are.
2. Ask your agent to inspect the index and choose the skills useful for this
   project. Copy each whole folder from `.agents/skills/` for Codex or Cursor
   Agent, or from `.claude/skills/` for Claude. Cursor also reads
   `.claude/skills/`. Copy both trees when the project uses Claude.
3. Merge the required support files listed below. Preserve your own instructions,
   edited skills and report styles. Do not replace `AGENTS.md`, `CLAUDE.md`,
   context, MCP configuration or existing Workspace cards.
4. Start a fresh CLI session in the project if newly added skills are not listed.
   Ask the agent to read the chosen `SKILL.md` and inspect your actual project
   before making changes.

Example request:

> Read the game-vfx-workflow skill, inspect our current combat events and game
> camera, and prepare a small shield-impact proposal. Keep gameplay unchanged.
> Show the selected layers, attachment, cancellation rules and native review plan.

## Support files

| Skill | Additional files or tools |
| --- | --- |
| Six game workflows, Blender animation, motion references | Keep the skill's own references. Bring the project's source assets and an available engine/editor connection for implementation. |
| Image and generation workflows | Keep any referenced sibling provider skill. Configure your own optional provider and read its current capabilities. |
| img2threejs | Copy its entire folder, including code, resources and Apache-2.0 licence. Optional upstream integrations remain separate. |
| workspace-authoring | `processes/workspace-authoring.md`, `docs/editable-cards.md`, its images under `docs/assets/`, `desktop/service/card-schema.mjs`, and `workspace/_shared/{report.css,report.js,examples.css}`. Merge these with your own styles if needed. The desktop card editor/app is separate. |
| video-watch | `knowledge/video-watch.md`, `scripts/video-watch/` and the shared report assets. Install the optional Python requirements in a local virtual environment. |
| voice-dictation-setup | `knowledge/voice-dictation.md`. The dictation application and its model are separate installations. |
| Production routing | Choose and copy the relevant sibling skills from the index; a route name does not install that workflow. |

No generation is required to install the pack. Tools, accounts, API access,
Blender and Unity are not bundled. Review dependency requirements before running
a helper. For an offline first check, inspect a supplied local asset and prepare
a plan without submitting a paid job.

## What is included

Complete Codex and Claude skill copies, the support files above, licence notices,
and `manifest.json` with SHA-256 checksums for every payload file. There are no
private projects, original game assets, conversations, credentials or job receipts.
The pack does not change global agent settings.

The application and sample projects are available separately at
[Mr. Mak Workspace](https://github.com/witnesstodark/mr-mak-workspace).
